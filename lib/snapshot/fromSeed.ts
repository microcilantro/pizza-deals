import { dealFingerprint } from '@/lib/fingerprint';
import { seedDataset } from '@/seed/dataset';
import { seedToDeals } from '@/seed/toDeals';
import type { Snapshot, SnapshotDeal } from './types';
import { SNAPSHOT_VERSION } from './types';

/**
 * Converts the hand-entered seed dataset into a snapshot.
 *
 * This makes the seed "snapshot zero" rather than a parallel code path: the UI reads
 * snapshots and only snapshots, and the first real scrape merges on top of this one.
 * Provenance stays `manual_secondary` so the unverified banner keeps showing until
 * scraped rows replace these.
 */
export function seedSnapshot(capturedAt = seedDataset.capturedAt): Snapshot {
  const deals = seedToDeals(seedDataset);
  const iso = new Date(`${capturedAt}T00:00:00Z`).toISOString();

  const snapshotDeals: SnapshotDeal[] = deals.map((deal, i) => {
    const seed = seedDataset.deals[i]!;
    return {
      fingerprint: dealFingerprint(deal),
      chain: deal.chain,
      dealName: deal.dealName,
      kind: deal.kind,
      fulfillment: deal.fulfillment,
      priceUsd: deal.priceUsd,
      discountPercent: deal.discountPercent,
      discountScope: deal.discountScope,
      promoCode: deal.promoCode,
      validThrough: seed.validThrough ?? null,
      sourceUrl: deal.sourceUrl,
      pizzaItems: deal.pizzaItems.map((item) => ({
        quantity: item.quantity,
        sizeLabel: item.sizeLabel,
        shape: item.shape.kind,
        ...(item.shape.kind === 'round'
          ? { diameterIn: item.shape.diameterIn }
          : { lengthIn: item.shape.lengthIn, widthIn: item.shape.widthIn }),
        crustName: item.crust.name,
        crustClass: item.crust.class,
        toppingCount: item.toppingCount,
        toppingPolicy: item.toppingPolicy,
        premiumToppings: item.premiumToppings,
        menuPriceUsd: item.menuPriceUsd,
      })),
      otherItems: deal.otherItems.map((i2) => ({
        quantity: i2.quantity,
        category: i2.category,
        descriptor: i2.descriptor,
        menuPriceUsd: i2.menuPriceUsd,
      })),
      provenance: 'manual_secondary',
      notes: seed.note ? [seed.note] : [],
      firstSeen: iso,
      lastSeen: iso,
      lastVerifiedAt: iso,
      active: true,
      stale: false,
      priceHistory: [
        { observedAt: iso, priceUsd: deal.priceUsd, discountPercent: deal.discountPercent },
      ],
    };
  });

  return {
    version: SNAPSHOT_VERSION,
    capturedAt: iso,
    pricingLocale: seedDataset.pricingLocale,
    chains: seedDataset.chains.map((c) => ({
      slug: c.slug,
      displayName: c.displayName,
      menuUrl: c.menuUrl,
      dealsUrl: c.dealsUrl,
    })),
    chainStatus: seedDataset.chains.map((c) => ({
      chain: c.slug,
      displayName: c.displayName,
      // No scraper has ever run against these; they were entered by hand. Reporting
      // 'ok' here would claim a healthy scrape that never happened.
      status: 'never_scraped' as const,
      lastSuccessfulAt: null,
      errors: [],
      unparsed: [],
    })),
    sizes: seedDataset.sizes.map((s) => ({
      chain: s.chain,
      sizeLabel: s.sizeLabel,
      shape: s.shape,
      ...(s.shape === 'round' ? { diameterIn: s.diameterIn } : { lengthIn: s.lengthIn, widthIn: s.widthIn }),
      sourceUrl: s.sourceUrl,
      provenance: s.provenance,
      ...(s.note ? { note: s.note } : {}),
    })),
    crusts: seedDataset.crusts.map((c) => ({
      chain: c.chain,
      crustName: c.name,
      crustClass: c.crustClass,
      availableDiametersIn: [],
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      ...(c.note ? { note: c.note } : {}),
    })),
    componentValues: seedDataset.componentValues.map((c) => ({
      chain: c.chain,
      category: c.category,
      descriptor: c.descriptor,
      menuPriceUsd: c.menuPriceUsd,
      sourceUrl: c.sourceUrl,
      provenance: c.provenance,
      ...(c.note ? { note: c.note } : {}),
    })),
    deliveryFees: seedDataset.deliveryFees.map((f) => ({
      chain: f.chain,
      feeUsd: f.feeUsd,
      sourceUrl: f.sourceUrl,
      provenance: f.provenance,
    })),
    deals: snapshotDeals,
  };
}
