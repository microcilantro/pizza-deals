import 'server-only';
import { seedDataset } from '@/db/seed/dataset';
import { seedDeliveryFees, seedToDeals } from '@/db/seed/toDeals';
import type { Deal } from '@/lib/normalize/types';

/**
 * The UI's single source of deals.
 *
 * Reads Postgres when DATABASE_URL is configured and falls back to the seed dataset
 * otherwise, so the interface can be built and reviewed before a database exists. The
 * chosen source is returned, not hidden — the page renders a banner saying which one it
 * is, because "these are unverified hand-entered prices" is something a user comparing
 * real money deserves to see.
 */

export type DealSource = 'database' | 'seed';

export interface DealFeed {
  deals: Deal[];
  deliveryFees: Record<string, number>;
  source: DealSource;
  /** Whether any row in the feed is unverified against a chain's own page. */
  hasUnverifiedData: boolean;
  capturedAt: string;
  pricingLocale: string;
  /** Per-chain scraper health, for the staleness indicator. */
  chainStatus: ChainStatus[];
}

export interface ChainStatus {
  chain: string;
  displayName: string;
  lastVerifiedAt: Date;
  stale: boolean;
}

export async function getDealFeed(): Promise<DealFeed> {
  if (process.env.DATABASE_URL) {
    try {
      return await readFromDatabase();
    } catch (error) {
      // A database that is configured but unreachable must not blank the page. Fall
      // back to the seed and let the banner say the data is not live.
      console.error('[deals] database read failed, falling back to seed:', error);
    }
  }
  return readFromSeed();
}

function readFromSeed(): DealFeed {
  const deals = seedToDeals(seedDataset);
  const capturedAt = new Date(`${seedDataset.capturedAt}T00:00:00Z`);

  return {
    deals,
    deliveryFees: seedDeliveryFees(seedDataset),
    source: 'seed',
    hasUnverifiedData: true,
    capturedAt: seedDataset.capturedAt,
    pricingLocale: seedDataset.pricingLocale,
    chainStatus: seedDataset.chains.map((chain) => ({
      chain: chain.slug,
      displayName: chain.displayName,
      lastVerifiedAt: capturedAt,
      stale: isStale(capturedAt),
    })),
  };
}

/**
 * A deal is stale when no scrape has confirmed it recently. The job runs at most daily,
 * so two days without a confirmation means something is broken rather than merely quiet.
 */
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export function isStale(lastVerifiedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastVerifiedAt.getTime() > STALE_AFTER_MS;
}

/**
 * NOTE: unexercised in the current environment — no database has been provisioned, and
 * this sandbox cannot reach one. The shape mirrors `db/seed/seed.ts` exactly, which is
 * the tested write path, but treat this as unverified until it runs against real Neon.
 */
async function readFromDatabase(): Promise<DealFeed> {
  const [{ neon }, { drizzle }, { eq }, schema] = await Promise.all([
    import('@neondatabase/serverless'),
    import('drizzle-orm/neon-http'),
    import('drizzle-orm'),
    import('@/db/schema'),
  ]);

  const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

  const rows = await db
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.active, true));

  const chainRows = await db.select().from(schema.chains);
  const chainById = new Map(chainRows.map((c) => [c.id, c]));

  const pizzaItems = await db.select().from(schema.dealPizzaItems);
  const otherItems = await db.select().from(schema.dealOtherItems);
  const componentRows = await db.select().from(schema.componentValues);
  const menuPriceRows = await db.select().from(schema.menuPizzaPrices);
  const feeRows = await db.select().from(schema.deliveryFeeObservations);

  const componentById = new Map(componentRows.map((c) => [c.id, c]));
  const menuPriceById = new Map(menuPriceRows.map((m) => [m.id, m]));
  const crustRows = await db.select().from(schema.crustOptions);
  const crustById = new Map(crustRows.map((c) => [c.id, c]));

  const deals: Deal[] = rows.map((row) => {
    const chain = chainById.get(row.chainId);
    return {
      id: row.id,
      chain: chain?.slug ?? String(row.chainId),
      dealName: row.dealName,
      kind: row.kind,
      fulfillment: row.fulfillment,
      priceUsd: row.priceUsd === null ? null : Number(row.priceUsd),
      discountPercent: row.discountPercent === null ? null : Number(row.discountPercent),
      discountScope: row.discountScope,
      pricingLocale: row.pricingLocale,
      pizzaItems: pizzaItems
        .filter((i) => i.dealId === row.id)
        .map((i) => {
          const crust = crustById.get(i.crustOptionId);
          const menuPrice = i.menuPriceId ? menuPriceById.get(i.menuPriceId) : undefined;
          return {
            quantity: i.quantity,
            shape:
              i.shape === 'round'
                ? ({ kind: 'round', diameterIn: Number(i.diameterIn) } as const)
                : ({
                    kind: 'rect',
                    lengthIn: Number(i.lengthIn),
                    widthIn: Number(i.widthIn),
                  } as const),
            sizeLabel: i.sizeLabel,
            crust: { name: crust?.crustName ?? 'Unknown', class: crust?.crustClass ?? 'standard' },
            toppingCount: i.toppingCount,
            toppingPolicy: i.toppingPolicy,
            premiumToppings: i.premiumToppings,
            menuPriceUsd: menuPrice ? Number(menuPrice.menuPriceUsd) : null,
          };
        }),
      otherItems: otherItems
        .filter((i) => i.dealId === row.id)
        .map((i) => {
          const component = i.componentValueId ? componentById.get(i.componentValueId) : undefined;
          return {
            quantity: i.quantity,
            category: i.category,
            descriptor: i.descriptor,
            menuPriceUsd: component ? Number(component.menuPriceUsd) : null,
          };
        }),
      promoCode: row.promoCode,
      sourceUrl: row.sourceUrl,
      stale: row.stale,
      lastVerifiedAt: row.lastVerifiedAt,
    };
  });

  // Latest observed fee per chain.
  const deliveryFees: Record<string, number> = {};
  for (const fee of feeRows) {
    const slug = chainById.get(fee.chainId)?.slug;
    if (slug) deliveryFees[slug] = Number(fee.feeUsd);
  }

  const latestVerified = rows.reduce<Date>(
    (latest, r) => (r.lastVerifiedAt > latest ? r.lastVerifiedAt : latest),
    new Date(0),
  );

  return {
    deals,
    deliveryFees,
    source: 'database',
    hasUnverifiedData: rows.some((r) => r.provenance !== 'scraped'),
    capturedAt: latestVerified.toISOString().slice(0, 10),
    pricingLocale: rows[0]?.pricingLocale ?? 'san-diego-ca',
    chainStatus: chainRows.map((chain) => {
      const chainDeals = rows.filter((r) => r.chainId === chain.id);
      const lastVerifiedAt = chainDeals.reduce<Date>(
        (latest, r) => (r.lastVerifiedAt > latest ? r.lastVerifiedAt : latest),
        new Date(0),
      );
      return {
        chain: chain.slug,
        displayName: chain.displayName,
        lastVerifiedAt,
        stale: chainDeals.some((r) => r.stale) || isStale(lastVerifiedAt),
      };
    }),
  };
}

export const CHAIN_LABELS: Record<string, string> = {
  dominos: "DOMINO'S",
  pizza_hut: 'PIZZA HUT',
  papa_johns: "PAPA JOHN'S",
};
