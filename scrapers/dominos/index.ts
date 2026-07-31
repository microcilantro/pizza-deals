import type { Browser } from 'playwright';
import { createSession, RobotsDisallowedError, type ScrapeSession } from '../session';
import type { ScrapeResult, ScrapedDeal, ScrapedSize } from '../types';
import { extractDealCards, extractMenuSizes } from './extract';
import { parseDealCard, parseDiameterIn, parseRectDimensions, parseSizeLabel } from './parse';

export const DOMINOS = {
  slug: 'dominos',
  origin: 'https://www.dominos.com',
  dealsUrl: 'https://www.dominos.com/en/pages/order/#!/section/Coupons/',
  menuUrl: 'https://www.dominos.com/en/pages/order/menu#!/menu/category/pizza/',
} as const;

export interface RunOptions {
  artifactDir: string;
  /** Injected in tests; defaults to the real page fetch. */
  session?: ScrapeSession;
}

/**
 * Scrapes Domino's national deals and the menu sizes they resolve against.
 *
 * Order matters: the menu is read *first*, because a deal without a resolvable diameter
 * is not usable. Sizes come from the chain's own menu page every run rather than from a
 * stored table, since chains change sizing and a cached diameter goes wrong silently.
 *
 * Failure policy, per the brief: capture a screenshot and the HTML, log loudly, return a
 * status the caller can act on, and never delete anything. Keeping the last known good
 * data and marking it stale is the caller's job — this function only reports.
 */
export async function scrapeDominos(browser: Browser, options: RunOptions): Promise<ScrapeResult> {
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

  const { session, context } = options.session
    ? { session: options.session, context: null }
    : await createSession(browser, { chain: DOMINOS.slug, artifactDir: options.artifactDir });

  try {
    await session.loadRobots(DOMINOS.origin);

    // ---------------------------------------------------------------- menu / sizes
    try {
      const menuPage = await session.open(DOMINOS.menuUrl);
      try {
        const rows = await extractMenuSizes(menuPage);
        if (rows.length === 0) {
          result.status = 'partial';
          result.errors.push('No size rows found on the menu page; selectors may have changed.');
          result.screenshotPaths.push(...(await session.captureFailure(menuPage, 'menu-empty')));
        }

        for (const row of rows) {
          const text = `${row.label} ${row.descriptionText}`;
          const sizeLabel = parseSizeLabel(text) ?? row.label.trim();

          const rect = parseRectDimensions(text);
          if (rect) {
            result.sizes.push({
              sizeLabel,
              shape: 'rect',
              lengthIn: rect.lengthIn,
              widthIn: rect.widthIn,
              sourceUrl: DOMINOS.menuUrl,
            });
            continue;
          }

          const diameterIn = parseDiameterIn(text);
          if (diameterIn === null) {
            // A size whose diameter we cannot read is worse than useless — it would let
            // a deal through with no area. Report it and move on.
            result.unparsed.push({
              raw: text,
              reason: `Menu size "${sizeLabel}" states no diameter, so deals using it cannot be ranked.`,
            });
            result.status = result.status === 'failed' ? 'failed' : 'partial';
            continue;
          }

          result.sizes.push({
            sizeLabel,
            shape: 'round',
            diameterIn,
            sourceUrl: DOMINOS.menuUrl,
          });
        }
      } finally {
        await menuPage.close();
      }
    } catch (error) {
      result.status = 'partial';
      result.errors.push(`Menu scrape failed: ${describe(error)}`);
    }

    // --------------------------------------------------------------------- deals
    const dealsPage = await session.open(DOMINOS.dealsUrl);
    try {
      const cards = await extractDealCards(dealsPage, DOMINOS.dealsUrl);

      // An empty list is failure, not "no deals today". A chain always has coupons; a
      // silent empty result is exactly the outcome this design exists to prevent.
      if (cards.length === 0) {
        result.status = 'failed';
        result.errors.push('No deal cards found; selectors are stale or the page did not render.');
        result.screenshotPaths.push(...(await session.captureFailure(dealsPage, 'deals-empty')));
      }

      for (const card of cards) {
        const { deal, unparsed } = parseDealCard(card);
        if (deal) result.deals.push(withResolvableSize(deal, result.sizes, result));
        if (unparsed) result.unparsed.push(unparsed);
      }

      if (result.unparsed.length > 0 && result.status === 'ok') {
        result.status = 'partial';
      }
    } finally {
      await dealsPage.close();
    }
  } catch (error) {
    result.status = 'failed';
    result.errors.push(describe(error));
    if (error instanceof RobotsDisallowedError) {
      result.errors.push('Refusing to scrape a path robots.txt disallows.');
    }
  } finally {
    if (context) await context.close();
    result.screenshotPaths.push(...session.artifacts.filter((a) => a.endsWith('.png')));
    result.finishedAt = new Date();
  }

  if (result.status === 'failed') {
    console.error(`[dominos] scrape FAILED:`, result.errors.join(' | '));
  } else if (result.status === 'partial') {
    console.warn(
      `[dominos] scrape partial: ${result.deals.length} deals, ` +
        `${result.unparsed.length} unparsed. ${result.errors.join(' | ')}`,
    );
  }

  return result;
}

/**
 * A deal naming a size we did not scrape cannot have its area computed. Rather than
 * drop it, the deal is kept with a note — the caller stores it, and normalization marks
 * it unrankable with a visible reason.
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
          'until the menu scrape resolves that size.',
      ],
    };
  }
  return deal;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
