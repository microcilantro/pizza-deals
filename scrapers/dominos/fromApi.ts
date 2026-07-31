import type { RawDealCard, ScrapedDeal, ScrapedSize } from '../types';
import { parseDealCard, parseDiameterIn } from './parse';
import type { StoreMenuResponse } from './api';

/**
 * Maps Domino's menu payload into the rows the rest of the pipeline already understands.
 *
 * Deliberately thin. Coupon text is handed to `parseDealCard`, the same parser the DOM
 * path used, so the 44 tests covering "$7.99 Large 3-Topping Pizza", per-item pricing,
 * "any crust", topping ceilings and the refusal paths all keep working unchanged. The
 * endpoints changed where the text comes from, not what the text means.
 *
 * Two rules here are specific to this project's constraints and are the reason this file
 * is not a one-liner:
 *
 *   - `Local: true` marks a store-specific offer. The brief scopes this app to national
 *     deals, so those are excluded — and recorded as excluded rather than dropped, so
 *     the exclusion is auditable.
 *   - `ValidServiceMethods` decides carryout vs delivery. A coupon valid for both is
 *     TWO deals, because requirement 5 makes them separate rows with separate prices.
 *     A coupon that states neither is refused rather than assigned to one.
 */

/** The menu groups sizes by product category; only pizza has a diameter. */
export function sizesFromMenu(menu: StoreMenuResponse, sourceUrl: string): ScrapedSize[] {
  const sizes = (menu.Sizes ?? {}) as Record<string, Record<string, { Name?: string }>>;
  const pizzaSizes = sizes.Pizza ?? {};
  const out: ScrapedSize[] = [];

  for (const entry of Object.values(pizzaSizes)) {
    const name = entry?.Name;
    if (!name) continue;

    // "Large (14\")" -> label "Large", diameter 14. The chain states both; we take both
    // rather than mapping the label to a diameter ourselves.
    const diameterIn = parseDiameterIn(name);
    if (diameterIn === null) continue;

    const sizeLabel = name.replace(/\s*\(.*$/, '').trim();
    if (!sizeLabel) continue;

    out.push({ sizeLabel, shape: 'round', diameterIn, sourceUrl });
  }

  return out;
}

const SERVICE_METHODS: Record<string, 'carryout' | 'delivery'> = {
  carryout: 'carryout',
  carry_out: 'carryout',
  pickup: 'carryout',
  delivery: 'delivery',
};

function fulfillmentsFor(methods: readonly string[] | undefined): ('carryout' | 'delivery')[] {
  if (!methods) return [];
  const found = new Set<'carryout' | 'delivery'>();
  for (const method of methods) {
    const mapped = SERVICE_METHODS[method.trim().toLowerCase()];
    if (mapped) found.add(mapped);
  }
  return [...found];
}

export interface CouponMapping {
  deals: ScrapedDeal[];
  unparsed: { raw: string; reason: string }[];
}

export function dealsFromCoupons(menu: StoreMenuResponse, sourceUrl: string): CouponMapping {
  const deals: ScrapedDeal[] = [];
  const unparsed: CouponMapping['unparsed'] = [];

  for (const [code, coupon] of Object.entries(menu.Coupons ?? {})) {
    const name = coupon?.Name?.trim() ?? '';
    const description = coupon?.Description?.replace(/\s+/g, ' ').trim() ?? '';
    const raw = `${code} | ${name} | ${description}`;

    if (!name && !description) {
      unparsed.push({ raw, reason: 'Coupon has no name or description to interpret.' });
      continue;
    }

    // National-only scope: a store-local coupon is not comparable across the country.
    if (coupon?.Local === true) {
      unparsed.push({ raw, reason: 'Store-local offer, excluded by the national-only scope.' });
      continue;
    }

    const fulfillments = fulfillmentsFor(coupon?.ValidServiceMethods);
    if (fulfillments.length === 0) {
      unparsed.push({
        raw,
        reason:
          'Coupon states no valid service method, and carryout and delivery are separate ' +
          'rows that must not be guessed at.',
      });
      continue;
    }

    // One row per service method — the same offer can be a different value depending on
    // how you collect it, which is the whole reason requirement 5 exists.
    for (const fulfillment of fulfillments) {
      const card: RawDealCard = {
        title: name || description,
        description,
        priceText: coupon?.Price ? `$${coupon.Price}` : null,
        promoCode: code,
        fulfillmentText: fulfillment,
        validThroughText: null,
        sourceUrl,
      };

      const { deal, unparsed: rejected } = parseDealCard(card);
      if (deal) {
        deals.push({ ...deal, promoCode: code });
      } else if (rejected && fulfillment === fulfillments[0]) {
        // Report the rejection once, not once per service method.
        unparsed.push(rejected);
      }
    }
  }

  return { deals, unparsed };
}

/**
 * Base pizza prices, used to price percentage-off offers (D6).
 *
 * Variant names carry size, crust and product in one string — "Medium (12\") Thin Crust
 * Pacific Veggie" — so the diameter is available per variant as well as in `Sizes`.
 */
export function menuPricesFromVariants(
  menu: StoreMenuResponse,
  sourceUrl: string,
): { sizeLabel: string; crustName: string; toppingCount: number | null; menuPriceUsd: number; sourceUrl: string }[] {
  const out: ReturnType<typeof menuPricesFromVariants> = [];

  for (const variant of Object.values(menu.Variants ?? {})) {
    const name = variant?.Name;
    const price = Number(variant?.Price);
    if (!name || !Number.isFinite(price) || price <= 0) continue;
    if (parseDiameterIn(name) === null) continue; // not a pizza

    const sizeLabel = name.replace(/\s*\(.*$/, '').trim();
    const crustName = /thin/i.test(name)
      ? 'Crunchy Thin'
      : /brooklyn/i.test(name)
        ? 'Brooklyn Style'
        : /pan/i.test(name)
          ? 'Handmade Pan'
          : 'Hand Tossed';

    out.push({ sizeLabel, crustName, toppingCount: null, menuPriceUsd: price, sourceUrl });
  }

  return out;
}
