import type { Deal, PizzaItem, Shape } from '@/lib/normalize/types';
import type { SeedCrust, SeedDataset, SeedDeal, SeedSize } from './types';

/**
 * Turns the seed dataset into the plain `Deal` objects the normalization module consumes.
 *
 * Resolution is by lookup, never by inlining: a seed item names a size label and a crust,
 * and the diameter comes from the `sizes` table. That is the same path the scraper will
 * take, so if a lookup is missing the seed fails here rather than producing a deal with a
 * quietly invented size.
 */

export class SeedResolutionError extends Error {}

function sizeKey(chain: string, sizeLabel: string, crustName?: string): string {
  return `${chain}|${sizeLabel}|${crustName ?? '*'}`;
}

function shapeOf(size: SeedSize): Shape {
  return size.shape === 'round'
    ? { kind: 'round', diameterIn: size.diameterIn }
    : { kind: 'rect', lengthIn: size.lengthIn, widthIn: size.widthIn };
}

export function seedToDeals(dataset: SeedDataset): Deal[] {
  const sizes = new Map<string, SeedSize>();
  for (const s of dataset.sizes) {
    sizes.set(sizeKey(s.chain, s.sizeLabel, s.crustName), s);
  }

  const crusts = new Map<string, SeedCrust>();
  for (const c of dataset.crusts) {
    crusts.set(`${c.chain}|${c.name}`, c);
  }

  const menuPrices = new Map<string, number>();
  for (const p of dataset.menuPizzaPrices) {
    menuPrices.set(`${p.chain}|${p.sizeLabel}|${p.crustName}|${p.toppingCount ?? '*'}`, p.menuPriceUsd);
  }

  const componentPrices = new Map<string, number>();
  for (const c of dataset.componentValues) {
    componentPrices.set(`${c.chain}|${c.descriptor}`, c.menuPriceUsd);
  }

  return dataset.deals.map((seed, index) => toDeal(seed, index, dataset, {
    sizes,
    crusts,
    menuPrices,
    componentPrices,
  }));
}

interface Lookups {
  sizes: Map<string, SeedSize>;
  crusts: Map<string, SeedCrust>;
  menuPrices: Map<string, number>;
  componentPrices: Map<string, number>;
}

function toDeal(seed: SeedDeal, index: number, dataset: SeedDataset, lookups: Lookups): Deal {
  const pizzaItems: PizzaItem[] = seed.pizzaItems.map((item) => {
    // Prefer a crust-specific size row, fall back to the chain-wide one.
    const size =
      lookups.sizes.get(sizeKey(seed.chain, item.sizeLabel, item.crustName)) ??
      lookups.sizes.get(sizeKey(seed.chain, item.sizeLabel));
    if (!size) {
      throw new SeedResolutionError(
        `No size observation for ${seed.chain} "${item.sizeLabel}" (deal: ${seed.dealName}). ` +
          'Add one to the dataset rather than inlining a diameter.',
      );
    }

    const crust = lookups.crusts.get(`${seed.chain}|${item.crustName}`);
    if (!crust) {
      throw new SeedResolutionError(
        `No crust "${item.crustName}" for ${seed.chain} (deal: ${seed.dealName}).`,
      );
    }

    const quantity = item.quantity ?? 1;
    const menuPriceUsd =
      lookups.menuPrices.get(
        `${seed.chain}|${item.sizeLabel}|${item.crustName}|${item.toppingCount ?? '*'}`,
      ) ?? null;

    return {
      quantity,
      shape: shapeOf(size),
      sizeLabel: item.sizeLabel,
      crust: { name: crust.name, class: crust.crustClass },
      toppingCount: item.toppingCount,
      toppingPolicy: item.toppingPolicy ?? 'exact',
      premiumToppings: item.premiumToppings ?? false,
      menuPriceUsd,
    };
  });

  return {
    id: index + 1,
    chain: seed.chain,
    dealName: seed.dealName,
    kind: seed.kind,
    fulfillment: seed.fulfillment,
    priceUsd: seed.priceUsd,
    discountPercent: seed.discountPercent ?? null,
    discountScope: seed.discountScope ?? null,
    pricingLocale: dataset.pricingLocale,
    pizzaItems,
    otherItems: (seed.otherItems ?? []).map((item) => ({
      quantity: item.quantity ?? 1,
      category: item.category,
      descriptor: item.descriptor,
      menuPriceUsd: lookups.componentPrices.get(`${seed.chain}|${item.descriptor}`) ?? null,
    })),
    promoCode: seed.promoCode ?? null,
    sourceUrl: seed.sourceUrl,
    stale: false,
    lastVerifiedAt: new Date(`${dataset.capturedAt}T00:00:00Z`),
  };
}

/** Delivery fees in the shape `NormalizationOptions` wants. Empty until one is sourced. */
export function seedDeliveryFees(dataset: SeedDataset): Record<string, number> {
  return Object.fromEntries(dataset.deliveryFees.map((f) => [f.chain, f.feeUsd]));
}
