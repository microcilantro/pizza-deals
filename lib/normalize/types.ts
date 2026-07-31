/**
 * Shared vocabulary for the normalization module.
 *
 * These types are deliberately decoupled from the Drizzle row types. The normalization
 * module is pure — no DB access, no I/O, no per-chain branches — so it takes plain
 * objects that a scraper, a seed fixture, or a query can all produce. Anything
 * chain-specific belongs in the scraper that produced the row, never here.
 */

export type CrustClass = 'standard' | 'thin' | 'specialty';
export type Fulfillment = 'carryout' | 'delivery';
export type DealKind = 'single_pizza' | 'multi_pizza' | 'bundle';
export type ToppingPolicy = 'exact' | 'up_to' | 'unlimited' | 'specialty_fixed';
export type DiscountScope = 'pizza' | 'order';

/**
 * Not every pizza is round. Pizza Hut sells a rectangular Detroit-style, so diameter
 * cannot be the universal size key — area is, and diameter is one way to reach it.
 */
export type Shape =
  | { kind: 'round'; diameterIn: number }
  | { kind: 'rect'; lengthIn: number; widthIn: number };

export interface PizzaItem {
  quantity: number;
  shape: Shape;
  /** Display only. "Large" is 14" at one chain and ~13.5" at another; never compare on it. */
  sizeLabel: string;
  crust: { name: string; class: CrustClass };
  toppingCount: number | null;
  toppingPolicy: ToppingPolicy;
  premiumToppings: boolean;
  /** Base à-la-carte price, required to resolve a percentage-off deal (D6). */
  menuPriceUsd: number | null;
}

export interface OtherItem {
  quantity: number;
  category: string;
  descriptor: string;
  /** À-la-carte menu price. Null means we could not price it — never treated as zero. */
  menuPriceUsd: number | null;
}

export interface Deal {
  id: number;
  chain: string;
  dealName: string;
  kind: DealKind;
  fulfillment: Fulfillment;
  /** Null only for percentage-off offers, which are priced from the menu instead. */
  priceUsd: number | null;
  discountPercent: number | null;
  discountScope: DiscountScope | null;
  pricingLocale: string;
  pizzaItems: PizzaItem[];
  otherItems: OtherItem[];
  promoCode: string | null;
  sourceUrl: string;
  stale: boolean;
  lastVerifiedAt: Date;
}

/** D3: 'area' ranks on cost per in² within a track; 'strict' also requires identical sizes. */
export type ComparabilityMode = 'area' | 'strict';

/** Requirement 4: bundles never share a ranking with pure-pizza deals. */
export type Track = 'pizza' | 'bundle';

export interface NormalizationOptions {
  /** D1: default false. When true, delivery rows carry the chain's observed fee. */
  includeDeliveryFee: boolean;
  /** Chain slug -> observed delivery fee. */
  deliveryFees: Record<string, number>;
  /** D4: fraction of à-la-carte menu price credited to bundle components. Default 1.0. */
  componentCreditFactor: number;
  /** D3: default 'area'. */
  comparability: ComparabilityMode;
}

export const DEFAULT_OPTIONS: NormalizationOptions = {
  includeDeliveryFee: false,
  deliveryFees: {},
  componentCreditFactor: 1.0,
  comparability: 'area',
};

/**
 * Assumptions ride on the metrics object rather than in a side channel, so every number
 * the UI renders can be traced to what produced it. This is the brief's "surface the
 * assumption rather than hiding it" made structural instead of aspirational.
 */
export type AssumptionCode =
  | 'DERIVED_FROM_DISCOUNT'
  | 'DELIVERY_FEE_INCLUDED'
  | 'BUNDLE_CREDIT'
  | 'BUNDLE_CREDIT_PARTIAL'
  | 'BUNDLE_NOT_IMPUTED'
  | 'TOPPING_COUNT_IS_MAXIMUM'
  | 'STALE_DATA';

export interface Assumption {
  code: AssumptionCode;
  message: string;
}

export type WarningCode =
  | 'IMPUTED_PRICE_NONPOSITIVE'
  | 'MISSING_MENU_PRICE'
  | 'MIXED_CRUST_CLASS'
  | 'ORDER_SCOPE_DISCOUNT_ON_BUNDLE'
  | 'NO_PIZZA_ITEMS';

export interface Warning {
  code: WarningCode;
  message: string;
}

export type MetricBasis = 'as_advertised' | 'imputed_pizza_only';
export type PricingBasis = 'advertised' | 'derived_from_discount';

export interface Segment {
  track: Track;
  crustClass: CrustClass;
  fulfillment: Fulfillment;
  /** Sorted multiset of areas, e.g. "113.10x2". Only part of the key in strict mode. */
  areaProfile: string;
}

export interface DealMetrics {
  totalAreaSqIn: number;
  /** What the shopper pays under the current options, before any bundle credit. */
  grossPriceUsd: number;
  /** The figure cost-per-in² is computed from, after bundle credit. */
  effectivePriceUsd: number;
  costPerSqIn: number;
  basis: MetricBasis;
  pricingBasis: PricingBasis;
  costPerToppingSlot: number | null;
  segment: Segment;
  comparabilityKey: string;
  assumptions: Assumption[];
  warnings: Warning[];
  /** False when we refuse to produce a comparable number; see `warnings` for why. */
  rankable: boolean;
}
