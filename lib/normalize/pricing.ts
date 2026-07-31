import type { Assumption, Deal, NormalizationOptions, PricingBasis, Warning } from './types';

/**
 * Rounds to cents, half up.
 *
 * `usd * 100` can land just under an exact half-cent boundary in binary floating point —
 * 50% off $16.99 gives 849.4999999999999, not 849.5 — which would silently drop a cent
 * on precisely the values a percentage discount produces. Collapsing to 12 significant
 * digits first puts it back on the boundary before rounding.
 */
export function roundCents(usd: number): number {
  return Math.round(Number((usd * 100).toPrecision(12))) / 100;
}

export function formatUsd(usd: number): string {
  return `$${roundCents(usd).toFixed(2)}`;
}

export interface GrossPrice {
  grossPriceUsd: number;
  pricingBasis: PricingBasis;
  assumptions: Assumption[];
  warnings: Warning[];
  /** False when no defensible price exists; the deal must not be ranked. */
  resolved: boolean;
}

/**
 * Resolves what the shopper actually pays, before any bundle credit.
 *
 * Two things happen here. First, D6: a percentage-off offer carries no dollar amount, so
 * its price is derived from the scraped à-la-carte menu prices of the pizzas it applies
 * to. If those menu prices are missing we refuse rather than guess. Second, D1: when the
 * delivery-fee toggle is on, delivery rows carry the chain's observed fee — often the
 * largest single swing between carryout and delivery, and invisible in sticker price.
 */
export function resolveGrossPrice(deal: Deal, opts: NormalizationOptions): GrossPrice {
  const assumptions: Assumption[] = [];
  const warnings: Warning[] = [];

  let base: number | null = null;
  let pricingBasis: PricingBasis = 'advertised';

  if (deal.priceUsd !== null) {
    base = deal.priceUsd;
  } else if (deal.discountPercent !== null) {
    pricingBasis = 'derived_from_discount';

    // An order-wide discount applies to the sides too, so crediting them at full menu
    // price against an already-discounted total would double-count. Refuse instead.
    if (deal.discountScope === 'order' && deal.otherItems.length > 0) {
      warnings.push({
        code: 'ORDER_SCOPE_DISCOUNT_ON_BUNDLE',
        message:
          'Order-wide percentage discount on a bundle: the discount and the component ' +
          'credit would overlap, so no comparable price is computed.',
      });
    } else {
      const menuTotal = sumPizzaMenuPrices(deal);
      if (menuTotal === null) {
        warnings.push({
          code: 'MISSING_MENU_PRICE',
          message:
            'Percentage-off offer with no à-la-carte menu price for one or more pizzas, ' +
            'so no price can be derived.',
        });
      } else {
        base = menuTotal * (1 - deal.discountPercent / 100);
        assumptions.push({
          code: 'DERIVED_FROM_DISCOUNT',
          message:
            `Price derived: ${deal.discountPercent}% off a menu price of ` +
            `${formatUsd(menuTotal)}, giving ${formatUsd(base)}.`,
        });
      }
    }
  }

  if (base === null) {
    return { grossPriceUsd: 0, pricingBasis, assumptions, warnings, resolved: false };
  }

  if (opts.includeDeliveryFee && deal.fulfillment === 'delivery') {
    const fee = opts.deliveryFees[deal.chain];
    if (fee !== undefined && fee > 0) {
      base += fee;
      assumptions.push({
        code: 'DELIVERY_FEE_INCLUDED',
        message: `Includes ${formatUsd(fee)} observed delivery fee for ${deal.chain}.`,
      });
    }
  }

  return {
    grossPriceUsd: roundCents(base),
    pricingBasis,
    assumptions,
    warnings,
    resolved: true,
  };
}

/** Null if any pizza item lacks a menu price — a missing price is never treated as zero. */
function sumPizzaMenuPrices(deal: Deal): number | null {
  if (deal.pizzaItems.length === 0) return null;
  let total = 0;
  for (const item of deal.pizzaItems) {
    if (item.menuPriceUsd === null) return null;
    total += item.menuPriceUsd * item.quantity;
  }
  return total;
}
