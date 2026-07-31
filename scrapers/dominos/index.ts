import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { ScrapeResult, ScrapedDeal, ScrapedSize } from '../types';
import {
  ApiRobotsDisallowedError,
  COMPARISON_MARKET,
  type Market,
  REFERENCE_MARKET,
  createApiClient,
  loadApiRobots,
  storeLocatorUrl,
  storeMenuUrl,
  type StoreLocatorResponse,
  type StoreMenuResponse,
} from './api';
import { dealsFromCoupons, menuPricesFromVariants, sizesFromMenu } from './fromApi';

export const DOMINOS = {
  slug: 'dominos',
  origin: 'https://www.dominos.com',
  dealsUrl: 'https://www.dominos.com/en/pages/order/#!/section/Coupons/',
  menuUrl: 'https://www.dominos.com/en/pages/order/menu#!/menu/category/pizza/',
} as const;

export interface RunOptions {
  artifactDir: string;
}

/**
 * Scrapes Domino's national deals from the ordering endpoints.
 *
 * This replaced a DOM scraper that could never have worked: the rendered coupon page
 * contains no prices at all until a store is selected, so there was nothing to parse.
 * The endpoints take the store as a parameter, which turns the reference market (D5)
 * from a label into an explicit input, and they state diameters directly —
 * `Sizes.Pizza.14.Name = "Large (14\")"` — which is exactly what requirement 1 asks for
 * and what no reference table could honestly provide.
 *
 * The browser argument is unused here and kept only so every chain scraper shares one
 * signature; chains whose data is only in rendered HTML will still need it.
 *
 * Failure policy is unchanged: log loudly, keep the payload for diagnosis, return a
 * status, delete nothing. Preserving the last known good data is the merge step's job.
 */
export async function scrapeDominos(
  _browser: Browser | null,
  options: RunOptions,
): Promise<ScrapeResult> {
  const startedAt = new Date();
  const result: ScrapeResult = {
    chain: DOMINOS.slug,
    status: 'ok',
    startedAt,
    finishedAt: startedAt,
    sizes: [],
    crusts: [],
    menuPrices: [],
    deals: [],
    unparsed: [],
    errors: [],
    screenshotPaths: [],
  };

  try {
    // Permission first, every run. order.dominos.com is a different host from www, so
    // it gets its own robots.txt rather than inheriting assumptions.
    const robots = await loadApiRobots();
    const getJson = createApiClient({ robots });

    // ------------------------------------------------------------------ store
    const findStore = async (market: Market) => {
      const located = await getJson<StoreLocatorResponse>(storeLocatorUrl('Carryout', market));
      return (located.Stores ?? []).find((s) => s.IsOnlineCapable && s.StoreID);
    };

    const store = await findStore(REFERENCE_MARKET);

    if (!store?.StoreID) {
      result.status = 'failed';
      result.errors.push(
        `No online-capable store found for ${REFERENCE_MARKET.city}, ${REFERENCE_MARKET.region}. ` +
          'Every price is scoped to that market, so there is nothing to scrape without one.',
      );
      return finish(result);
    }

    // ------------------------------------------------------------------- menu
    const menuUrl = storeMenuUrl(store.StoreID);
    const menu = await getJson<StoreMenuResponse>(menuUrl);

    result.sizes = sizesFromMenu(menu, menuUrl);
    result.menuPrices = menuPricesFromVariants(menu, menuUrl);

    // No sizes means no areas, and without areas nothing can be ranked. That is a
    // failure even if coupons came back fine.
    if (result.sizes.length === 0) {
      result.status = 'failed';
      result.errors.push(
        'Menu payload stated no pizza diameters; deals cannot be ranked without them.',
      );
      result.screenshotPaths.push(...(await dumpPayload(options.artifactDir, 'menu', menu)));
    }

    /*
     * National scope, decided by comparing markets rather than by trusting a flag.
     * An offer running in both San Diego and Columbus is national; one running in only
     * one is not. If the comparison market cannot be reached the check is skipped rather
     * than silently discarding everything — a note records that it was skipped.
     */
    let nationalCodes: Set<string> | undefined;
    try {
      const comparisonStore = await findStore(COMPARISON_MARKET);
      if (comparisonStore?.StoreID) {
        const comparisonMenu = await getJson<StoreMenuResponse>(
          storeMenuUrl(comparisonStore.StoreID),
        );
        nationalCodes = new Set(Object.keys(comparisonMenu.Coupons ?? {}));
      }
    } catch (error) {
      result.errors.push(
        `Comparison market (${COMPARISON_MARKET.city}) unreachable, so the national-only ` +
          `check was skipped this run: ${describe(error)}`,
      );
      result.status = result.status === 'failed' ? 'failed' : 'partial';
    }

    const { deals, unparsed } = dealsFromCoupons(menu, menuUrl, { nationalCodes });
    result.unparsed.push(...unparsed);

    // An empty coupon list is failure, not "no deals today" — the chain always has some,
    // and a silent empty result is the outcome this whole design exists to prevent.
    if (deals.length === 0) {
      result.status = 'failed';
      result.errors.push(
        `No usable coupons in the menu payload (${unparsed.length} were seen but not usable).`,
      );
      result.screenshotPaths.push(...(await dumpPayload(options.artifactDir, 'coupons', menu)));
    } else {
      result.deals = deals.map((deal) => withResolvableSize(deal, result.sizes, result));
      if (result.unparsed.length > 0 && result.status === 'ok') result.status = 'partial';
    }
  } catch (error) {
    result.status = 'failed';
    result.errors.push(describe(error));
    if (error instanceof ApiRobotsDisallowedError) {
      result.errors.push('Refusing to fetch a path robots.txt disallows.');
    }
  }

  return finish(result);
}

function finish(result: ScrapeResult): ScrapeResult {
  result.finishedAt = new Date();

  if (result.status === 'failed') {
    console.error(`[dominos] scrape FAILED: ${result.errors.join(' | ')}`);
  } else if (result.status === 'partial') {
    console.warn(
      `[dominos] scrape partial: ${result.deals.length} deals, ` +
        `${result.sizes.length} sizes, ${result.unparsed.length} unparsed.`,
    );
  } else {
    console.log(`[dominos] scrape ok: ${result.deals.length} deals, ${result.sizes.length} sizes.`);
  }
  return result;
}

/**
 * The API equivalent of the DOM path's failure screenshot: keep the payload that
 * confounded us, so the next person can see what actually came back rather than
 * guessing from an error string.
 */
async function dumpPayload(
  artifactDir: string,
  label: string,
  payload: unknown,
): Promise<string[]> {
  try {
    await mkdir(artifactDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(artifactDir, `dominos-${label}-${stamp}.json`);
    await writeFile(file, JSON.stringify(payload, null, 2).slice(0, 2_000_000), 'utf8');
    return [file];
  } catch (error) {
    console.error('[dominos] could not write payload artifact:', error);
    return [];
  }
}

/**
 * A deal naming a size the menu did not state cannot have its area computed. The deal is
 * kept with a note rather than dropped; normalization marks it unrankable and says why.
 */
function withResolvableSize(
  deal: ScrapedDeal,
  sizes: ScrapedSize[],
  result: ScrapeResult,
): ScrapedDeal {
  const known = new Set(sizes.map((s) => s.sizeLabel.toLowerCase()));
  const missing = deal.pizzaItems
    .map((i) => i.sizeLabel)
    .filter((label) => !known.has(label.toLowerCase()));

  if (missing.length > 0) {
    result.status = result.status === 'failed' ? 'failed' : 'partial';
    return {
      ...deal,
      notes: [
        ...deal.notes,
        `No scraped diameter for size "${missing.join(', ')}" — this deal cannot be ranked ` +
          'until the menu resolves that size.',
      ],
    };
  }
  return deal;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
