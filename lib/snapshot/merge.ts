import { dealFingerprint } from '@/lib/fingerprint';
import type { ScrapeResult, ScrapedDeal, ScrapedSize } from '@/scrapers/types';
import type {
  ChainSnapshotStatus,
  Snapshot,
  SnapshotDeal,
  SnapshotPizzaItem,
  SnapshotSize,
} from './types';
import { SNAPSHOT_VERSION } from './types';

/**
 * Folds a day's scrape results into the previous snapshot.
 *
 * This is the part Postgres used to do, and the rules are the interesting bit:
 *
 * - A deal is identified by fingerprint, which excludes price. A price change updates
 *   the deal and appends to its history; it does not create a new one and does not reset
 *   `firstSeen`.
 * - A chain whose scrape FAILED keeps its previous deals verbatim, marked stale. The
 *   brief is explicit: keep the last known good data and mark it, never delete.
 * - A chain that scraped successfully but no longer lists a deal marks it inactive
 *   rather than dropping it, so the record of it having existed survives.
 * - Reference data (sizes, crusts, component prices) is replaced only for chains that
 *   scraped successfully, and carried forward otherwise. A failed menu scrape must not
 *   silently erase the diameters everything else depends on.
 */

export interface MergeOptions {
  now: Date;
  pricingLocale: string;
  chains: Snapshot['chains'];
}

export function mergeScrape(
  previous: Snapshot | null,
  results: readonly ScrapeResult[],
  options: MergeOptions,
): Snapshot {
  const nowIso = options.now.toISOString();
  const scrapedChains = new Set(results.map((r) => r.chain));

  const previousDeals = new Map((previous?.deals ?? []).map((d) => [key(d.chain, d.fingerprint), d]));

  const deals: SnapshotDeal[] = [];
  const chainStatus: ChainSnapshotStatus[] = [];
  const sizes: SnapshotSize[] = [];

  // Chains we did not scrape at all this run keep everything they had, untouched.
  for (const deal of previous?.deals ?? []) {
    if (!scrapedChains.has(deal.chain)) deals.push(deal);
  }
  for (const size of previous?.sizes ?? []) {
    if (!scrapedChains.has(size.chain)) sizes.push(size);
  }

  for (const result of results) {
    const displayName =
      options.chains.find((c) => c.slug === result.chain)?.displayName ?? result.chain;
    const previousStatus = previous?.chainStatus.find((s) => s.chain === result.chain);

    if (result.status === 'failed') {
      // Carry the whole chain forward, marked stale. Everything else is unchanged.
      for (const deal of previous?.deals ?? []) {
        if (deal.chain === result.chain) deals.push({ ...deal, stale: true });
      }
      for (const size of previous?.sizes ?? []) {
        if (size.chain === result.chain) sizes.push(size);
      }
      chainStatus.push({
        chain: result.chain,
        displayName,
        status: 'failed',
        lastSuccessfulAt: previousStatus?.lastSuccessfulAt ?? null,
        errors: result.errors,
        unparsed: result.unparsed,
      });
      continue;
    }

    // Successful (or partial) scrape: sizes are replaced from this run.
    for (const size of result.sizes) {
      sizes.push({
        chain: result.chain,
        sizeLabel: size.sizeLabel,
        shape: size.shape,
        ...(size.diameterIn !== undefined ? { diameterIn: size.diameterIn } : {}),
        ...(size.lengthIn !== undefined ? { lengthIn: size.lengthIn } : {}),
        ...(size.widthIn !== undefined ? { widthIn: size.widthIn } : {}),
        sourceUrl: size.sourceUrl,
        provenance: 'scraped',
      });
    }

    const seenThisRun = new Set<string>();

    for (const scraped of result.deals) {
      const fingerprint = dealFingerprint(toFingerprintInput(scraped, result.sizes));
      const id = key(result.chain, fingerprint);
      seenThisRun.add(id);

      const prior = previousDeals.get(id);
      const merged = toSnapshotDeal(scraped, result, fingerprint, nowIso, prior);
      deals.push(merged);
    }

    // Deals the chain no longer lists: deactivate, never delete.
    for (const deal of previous?.deals ?? []) {
      if (deal.chain !== result.chain) continue;
      if (seenThisRun.has(key(deal.chain, deal.fingerprint))) continue;
      deals.push({ ...deal, active: false, stale: true });
    }

    chainStatus.push({
      chain: result.chain,
      displayName,
      status: result.status,
      lastSuccessfulAt: nowIso,
      errors: result.errors,
      unparsed: result.unparsed,
    });
  }

  // Chains never scraped in this run keep their previous status.
  for (const status of previous?.chainStatus ?? []) {
    if (!scrapedChains.has(status.chain)) chainStatus.push(status);
  }

  return {
    version: SNAPSHOT_VERSION,
    capturedAt: nowIso,
    pricingLocale: options.pricingLocale,
    chains: options.chains,
    chainStatus,
    sizes,
    // Reference data the scrapers do not yet produce is carried forward untouched.
    crusts: previous?.crusts ?? [],
    componentValues: previous?.componentValues ?? [],
    deliveryFees: previous?.deliveryFees ?? [],
    deals,
  };
}

function key(chain: string, fingerprint: string): string {
  return `${chain}::${fingerprint}`;
}

/**
 * The fingerprint is computed over resolved geometry, so a chain quietly shrinking a
 * pizza produces a new fingerprint rather than silently overwriting the old row.
 */
function toFingerprintInput(deal: ScrapedDeal, sizes: readonly ScrapedSize[]) {
  return {
    chain: '',
    dealName: deal.dealName,
    fulfillment: deal.fulfillment,
    pizzaItems: deal.pizzaItems.map((item) => ({
      quantity: item.quantity,
      shape: shapeFor(item.sizeLabel, sizes),
      sizeLabel: item.sizeLabel,
      crust: { name: item.crustName, class: 'standard' as const },
      toppingCount: item.toppingCount,
      toppingPolicy: item.toppingPolicy,
      premiumToppings: false,
      menuPriceUsd: null,
    })),
    otherItems: deal.otherItems.map((i) => ({
      quantity: i.quantity,
      category: i.category,
      descriptor: i.descriptor,
      menuPriceUsd: null,
    })),
  };
}

function shapeFor(sizeLabel: string, sizes: readonly ScrapedSize[]) {
  const size = sizes.find((s) => s.sizeLabel.toLowerCase() === sizeLabel.toLowerCase());
  if (size?.shape === 'rect' && size.lengthIn && size.widthIn) {
    return { kind: 'rect' as const, lengthIn: size.lengthIn, widthIn: size.widthIn };
  }
  // Unresolved sizes get a sentinel diameter so the fingerprint is still stable; the
  // deal itself is marked unresolvable below and will not be ranked.
  return { kind: 'round' as const, diameterIn: size?.diameterIn ?? 0 };
}

function toSnapshotDeal(
  scraped: ScrapedDeal,
  result: ScrapeResult,
  fingerprint: string,
  nowIso: string,
  prior: SnapshotDeal | undefined,
): SnapshotDeal {
  const pizzaItems: SnapshotPizzaItem[] = scraped.pizzaItems.map((item) => {
    const size = result.sizes.find(
      (s) => s.sizeLabel.toLowerCase() === item.sizeLabel.toLowerCase(),
    );
    return {
      quantity: item.quantity,
      sizeLabel: item.sizeLabel,
      shape: size?.shape ?? 'round',
      ...(size?.diameterIn !== undefined ? { diameterIn: size.diameterIn } : {}),
      ...(size?.lengthIn !== undefined ? { lengthIn: size.lengthIn } : {}),
      ...(size?.widthIn !== undefined ? { widthIn: size.widthIn } : {}),
      crustName: item.crustName,
      crustClass: 'standard',
      toppingCount: item.toppingCount,
      toppingPolicy: item.toppingPolicy,
      premiumToppings: false,
      menuPriceUsd: null,
    };
  });

  const priceChanged =
    prior !== undefined &&
    (prior.priceUsd !== scraped.priceUsd || prior.discountPercent !== scraped.discountPercent);

  const priceHistory = prior
    ? priceChanged
      ? [
          ...prior.priceHistory,
          {
            observedAt: nowIso,
            priceUsd: scraped.priceUsd,
            discountPercent: scraped.discountPercent,
          },
        ]
      : prior.priceHistory
    : [
        {
          observedAt: nowIso,
          priceUsd: scraped.priceUsd,
          discountPercent: scraped.discountPercent,
        },
      ];

  return {
    fingerprint,
    chain: result.chain,
    dealName: scraped.dealName,
    kind: scraped.kind,
    fulfillment: scraped.fulfillment,
    priceUsd: scraped.priceUsd,
    discountPercent: scraped.discountPercent,
    discountScope: scraped.discountScope,
    promoCode: scraped.promoCode,
    validThrough: scraped.validThrough,
    sourceUrl: scraped.sourceUrl,
    pizzaItems,
    otherItems: scraped.otherItems.map((i) => ({
      quantity: i.quantity,
      category: i.category,
      descriptor: i.descriptor,
      menuPriceUsd: null,
    })),
    provenance: 'scraped',
    notes: scraped.notes,
    // The identity that must survive: when we first saw this offer.
    firstSeen: prior?.firstSeen ?? nowIso,
    lastSeen: nowIso,
    lastVerifiedAt: nowIso,
    active: true,
    stale: false,
    priceHistory,
  };
}
