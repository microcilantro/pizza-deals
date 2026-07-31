import 'server-only';
import { seedDeliveryFees } from '@/seed/toDeals';
import { seedDataset } from '@/seed/dataset';
import { loadLatestSnapshot } from '@/lib/snapshot/load';
import { seedSnapshot } from '@/lib/snapshot/fromSeed';
import type { Snapshot } from '@/lib/snapshot/types';
import type { Deal } from '@/lib/normalize/types';

/**
 * The UI's single source of deals: the newest snapshot in `data/snapshots/`.
 *
 * Read at build time — the site is a static export, so there is no server at read time.
 * The daily job scrapes, merges into a new snapshot, commits it, and triggers a rebuild.
 * If no snapshot exists yet, the hand-entered seed stands in.
 *
 * The chosen source is returned rather than hidden, because the page renders a banner
 * saying whether these prices were scraped or entered by hand. Someone comparing real
 * money deserves to know which.
 */

export type DealSource = 'snapshot' | 'seed';

export interface DealFeed {
  deals: Deal[];
  deliveryFees: Record<string, number>;
  source: DealSource;
  hasUnverifiedData: boolean;
  capturedAt: string;
  pricingLocale: string;
  chainStatus: ChainStatus[];
}

export interface ChainStatus {
  chain: string;
  displayName: string;
  lastVerifiedAt: Date;
  /** Set by the scraper or the merge step; age-based staleness is decided in the browser. */
  stale: boolean;
}

export async function getDealFeed(): Promise<DealFeed> {
  const snapshot = await loadLatestSnapshot();
  return snapshot ? fromSnapshot(snapshot, 'snapshot') : fromSnapshot(seedSnapshot(), 'seed');
}

function fromSnapshot(snapshot: Snapshot, source: DealSource): DealFeed {
  // Inactive deals are kept in the file as a historical record but are not shown.
  const active = snapshot.deals.filter((d) => d.active);

  const componentPrices = new Map(
    snapshot.componentValues.map((c) => [`${c.chain}|${c.descriptor}`, c.menuPriceUsd]),
  );

  const deals: Deal[] = active.map((deal, index) => ({
    id: index + 1,
    chain: deal.chain,
    dealName: deal.dealName,
    kind: deal.kind,
    fulfillment: deal.fulfillment,
    priceUsd: deal.priceUsd,
    discountPercent: deal.discountPercent,
    discountScope: deal.discountScope,
    pricingLocale: snapshot.pricingLocale,
    pizzaItems: deal.pizzaItems.map((item) => ({
      quantity: item.quantity,
      shape:
        item.shape === 'round'
          ? ({ kind: 'round', diameterIn: item.diameterIn ?? 0 } as const)
          : ({ kind: 'rect', lengthIn: item.lengthIn ?? 0, widthIn: item.widthIn ?? 0 } as const),
      sizeLabel: item.sizeLabel,
      crust: { name: item.crustName, class: item.crustClass },
      toppingCount: item.toppingCount,
      toppingPolicy: item.toppingPolicy,
      premiumToppings: item.premiumToppings,
      menuPriceUsd: item.menuPriceUsd,
    })),
    otherItems: deal.otherItems.map((item) => ({
      quantity: item.quantity,
      category: item.category,
      descriptor: item.descriptor,
      // Prefer the price stored on the item; fall back to the chain's component table.
      menuPriceUsd:
        item.menuPriceUsd ?? componentPrices.get(`${deal.chain}|${item.descriptor}`) ?? null,
    })),
    promoCode: deal.promoCode,
    sourceUrl: deal.sourceUrl,
    stale: deal.stale,
    lastVerifiedAt: new Date(deal.lastVerifiedAt),
  }));

  const deliveryFees: Record<string, number> = {};
  for (const fee of snapshot.deliveryFees) deliveryFees[fee.chain] = fee.feeUsd;

  return {
    deals,
    deliveryFees:
      Object.keys(deliveryFees).length > 0 ? deliveryFees : seedDeliveryFees(seedDataset),
    source,
    hasUnverifiedData: active.some((d) => d.provenance !== 'scraped'),
    capturedAt: snapshot.capturedAt.slice(0, 10),
    pricingLocale: snapshot.pricingLocale,
    chainStatus: snapshot.chains.map((chain) => {
      const chainDeals = active.filter((d) => d.chain === chain.slug);
      const status = snapshot.chainStatus.find((s) => s.chain === chain.slug);
      const lastVerifiedAt = chainDeals.reduce<Date>(
        (latest, d) => {
          const at = new Date(d.lastVerifiedAt);
          return at > latest ? at : latest;
        },
        new Date(snapshot.capturedAt),
      );
      return {
        chain: chain.slug,
        displayName: chain.displayName,
        lastVerifiedAt,
        stale: status?.status === 'failed' || chainDeals.some((d) => d.stale),
      };
    }),
  };
}

export const CHAIN_LABELS: Record<string, string> = {
  dominos: "DOMINO'S",
  pizza_hut: 'PIZZA HUT',
  papa_johns: "PAPA JOHN'S",
};
