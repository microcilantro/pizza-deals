/**
 * Loads the seed dataset into Postgres. Idempotent — safe to re-run.
 *
 *   DATABASE_URL=postgres://... npx tsx db/seed/seed.ts
 *
 * Every row is written with its dataset provenance (`manual_secondary`), not the
 * `scraped` column default. That distinction is what lets the UI mark unverified data,
 * and what lets the Domino's scraper later overwrite these rows without ambiguity about
 * which is which.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, eq } from 'drizzle-orm';
import { dealFingerprint } from '@/lib/fingerprint';
import * as schema from '../schema';
import { seedDataset } from './dataset';
import { seedToDeals } from './toDeals';
import type { SeedDataset } from './types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export async function seed(db: Db, dataset: SeedDataset = seedDataset): Promise<void> {
  const chainIds = new Map<string, number>();
  for (const chain of dataset.chains) {
    const [row] = await db
      .insert(schema.chains)
      .values(chain)
      .onConflictDoUpdate({
        target: schema.chains.slug,
        set: { displayName: chain.displayName, menuUrl: chain.menuUrl, dealsUrl: chain.dealsUrl },
      })
      .returning({ id: schema.chains.id });
    chainIds.set(chain.slug, row!.id);
  }

  const chainId = (slug: string): number => {
    const id = chainIds.get(slug);
    if (id === undefined) throw new Error(`Seed references unknown chain "${slug}"`);
    return id;
  };

  const crustIds = new Map<string, number>();
  for (const crust of dataset.crusts) {
    const [row] = await db
      .insert(schema.crustOptions)
      .values({
        chainId: chainId(crust.chain),
        crustName: crust.name,
        crustClass: crust.crustClass,
        observedUpchargeUsd: crust.upchargeUsd?.toFixed(2),
        provenance: crust.provenance,
        provenanceNote: crust.note,
        sourceUrl: crust.sourceUrl,
      })
      .onConflictDoUpdate({
        target: [schema.crustOptions.chainId, schema.crustOptions.crustName],
        set: { crustClass: crust.crustClass, lastSeen: new Date() },
      })
      .returning({ id: schema.crustOptions.id });
    crustIds.set(`${crust.chain}|${crust.name}`, row!.id);
  }

  for (const size of dataset.sizes) {
    await db.insert(schema.sizeObservations).values({
      chainId: chainId(size.chain),
      sizeLabel: size.sizeLabel,
      crustOptionId: size.crustName ? crustIds.get(`${size.chain}|${size.crustName}`) : null,
      shape: size.shape,
      diameterIn: size.shape === 'round' ? size.diameterIn.toFixed(2) : null,
      lengthIn: size.shape === 'rect' ? size.lengthIn.toFixed(2) : null,
      widthIn: size.shape === 'rect' ? size.widthIn.toFixed(2) : null,
      provenance: size.provenance,
      provenanceNote: size.note,
      sourceUrl: size.sourceUrl,
    });
  }

  for (const price of dataset.menuPizzaPrices) {
    const crustOptionId = crustIds.get(`${price.chain}|${price.crustName}`);
    if (crustOptionId === undefined) {
      throw new Error(`Menu price references unknown crust "${price.crustName}"`);
    }
    await db.insert(schema.menuPizzaPrices).values({
      chainId: chainId(price.chain),
      sizeLabel: price.sizeLabel,
      crustOptionId,
      toppingCount: price.toppingCount,
      menuPriceUsd: price.menuPriceUsd.toFixed(2),
      pricingLocale: dataset.pricingLocale,
      provenance: price.provenance,
      provenanceNote: price.note,
      sourceUrl: price.sourceUrl,
    });
  }

  const componentValueIds = new Map<string, number>();
  for (const component of dataset.componentValues) {
    const [row] = await db
      .insert(schema.componentValues)
      .values({
        chainId: chainId(component.chain),
        category: component.category,
        descriptor: component.descriptor,
        menuPriceUsd: component.menuPriceUsd.toFixed(2),
        pricingLocale: dataset.pricingLocale,
        provenance: component.provenance,
        provenanceNote: component.note,
        sourceUrl: component.sourceUrl,
      })
      .returning({ id: schema.componentValues.id });
    componentValueIds.set(`${component.chain}|${component.descriptor}`, row!.id);
  }

  for (const fee of dataset.deliveryFees) {
    await db.insert(schema.deliveryFeeObservations).values({
      chainId: chainId(fee.chain),
      feeUsd: fee.feeUsd.toFixed(2),
      pricingLocale: dataset.pricingLocale,
      provenance: fee.provenance,
      provenanceNote: fee.note,
      sourceUrl: fee.sourceUrl,
    });
  }

  // Resolve deals through the same lookup path the app uses, so the DB can never hold a
  // deal whose diameter did not come from a size observation.
  const resolved = seedToDeals(dataset);

  for (const [index, seedDeal] of dataset.deals.entries()) {
    const deal = resolved[index]!;
    const fingerprint = dealFingerprint(deal);
    const id = chainId(seedDeal.chain);

    const [dealRow] = await db
      .insert(schema.deals)
      .values({
        chainId: id,
        fingerprint,
        dealName: seedDeal.dealName,
        kind: seedDeal.kind,
        fulfillment: seedDeal.fulfillment,
        priceUsd: seedDeal.priceUsd?.toFixed(2) ?? null,
        discountPercent: seedDeal.discountPercent?.toFixed(2) ?? null,
        discountScope: seedDeal.discountScope ?? null,
        pricingLocale: dataset.pricingLocale,
        promoCode: seedDeal.promoCode ?? null,
        validThrough: seedDeal.validThrough ?? null,
        provenance: seedDeal.provenance,
        provenanceNote: seedDeal.note,
        sourceUrl: seedDeal.sourceUrl,
        lastVerifiedAt: new Date(`${dataset.capturedAt}T00:00:00Z`),
      })
      .onConflictDoUpdate({
        target: [schema.deals.chainId, schema.deals.fingerprint],
        set: {
          dealName: seedDeal.dealName,
          priceUsd: seedDeal.priceUsd?.toFixed(2) ?? null,
          lastSeen: new Date(),
          lastVerifiedAt: new Date(`${dataset.capturedAt}T00:00:00Z`),
          active: true,
          stale: false,
        },
      })
      .returning({ id: schema.deals.id });

    const dealId = dealRow!.id;

    // Line items are replaced wholesale: they describe the offer's composition, and a
    // partial update would leave a stale pizza attached to a changed deal.
    await db.delete(schema.dealPizzaItems).where(eq(schema.dealPizzaItems.dealId, dealId));
    await db.delete(schema.dealOtherItems).where(eq(schema.dealOtherItems.dealId, dealId));

    for (const [i, item] of seedDeal.pizzaItems.entries()) {
      const resolvedItem = deal.pizzaItems[i]!;
      const crustOptionId = crustIds.get(`${seedDeal.chain}|${item.crustName}`);
      if (crustOptionId === undefined) {
        throw new Error(`Deal references unknown crust "${item.crustName}"`);
      }

      const sizeObservation = await db
        .select({ id: schema.sizeObservations.id })
        .from(schema.sizeObservations)
        .where(
          and(
            eq(schema.sizeObservations.chainId, id),
            eq(schema.sizeObservations.sizeLabel, item.sizeLabel),
          ),
        )
        .limit(1);

      await db.insert(schema.dealPizzaItems).values({
        dealId,
        quantity: resolvedItem.quantity,
        sizeLabel: item.sizeLabel,
        shape: resolvedItem.shape.kind === 'round' ? 'round' : 'rect',
        diameterIn:
          resolvedItem.shape.kind === 'round' ? resolvedItem.shape.diameterIn.toFixed(2) : null,
        lengthIn:
          resolvedItem.shape.kind === 'rect' ? resolvedItem.shape.lengthIn.toFixed(2) : null,
        widthIn: resolvedItem.shape.kind === 'rect' ? resolvedItem.shape.widthIn.toFixed(2) : null,
        sizeObservationId: sizeObservation[0]?.id ?? null,
        crustOptionId,
        toppingCount: item.toppingCount,
        toppingPolicy: item.toppingPolicy ?? 'exact',
        premiumToppings: item.premiumToppings ?? false,
      });
    }

    for (const item of seedDeal.otherItems ?? []) {
      await db.insert(schema.dealOtherItems).values({
        dealId,
        quantity: item.quantity ?? 1,
        category: item.category,
        descriptor: item.descriptor,
        componentValueId:
          componentValueIds.get(`${seedDeal.chain}|${item.descriptor}`) ?? null,
      });
    }

    await db.insert(schema.dealPriceHistory).values({
      dealId,
      priceUsd: seedDeal.priceUsd?.toFixed(2) ?? null,
      discountPercent: seedDeal.discountPercent?.toFixed(2) ?? null,
    });
  }
}

// Run directly: `DATABASE_URL=... npx tsx db/seed/seed.ts`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const db = drizzle(neon(url), { schema });
  seed(db)
    .then(() => {
      console.log(
        `Seeded ${seedDataset.deals.length} deals across ${seedDataset.chains.length} chains ` +
          `(captured ${seedDataset.capturedAt}, market ${seedDataset.pricingLocale}, ` +
          'all rows manual_secondary — unverified against the chains\' own pages).',
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
