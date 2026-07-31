import type {
  CrustClass,
  DealKind,
  DiscountScope,
  Fulfillment,
  ToppingPolicy,
} from '@/lib/normalize/types';

/**
 * Seed records mirror the shape a scraper will eventually produce, deliberately.
 *
 * In particular a seed pizza item references a size *label* and a crust *name*, and the
 * diameter is resolved by lookup — exactly as the scraper will resolve it from the
 * chain's own menu page. Inlining a diameter here would smuggle in the hardcoded size
 * table the brief rules out.
 */

export type Provenance = 'scraped' | 'manual_primary' | 'manual_secondary';

export interface Sourced {
  sourceUrl: string;
  provenance: Provenance;
  /** Conflicts between sources, restrictions we did not model, anything a reader needs. */
  note?: string;
}

export interface SeedChain {
  slug: string;
  displayName: string;
  menuUrl: string;
  dealsUrl: string;
}

export interface SeedCrust extends Sourced {
  chain: string;
  name: string;
  crustClass: CrustClass;
  upchargeUsd?: number;
}

export type SeedShape =
  | { shape: 'round'; diameterIn: number }
  | { shape: 'rect'; lengthIn: number; widthIn: number };

export type SeedSize = Sourced &
  SeedShape & {
    chain: string;
    sizeLabel: string;
    /** Set when a chain sizes a label differently depending on crust. */
    crustName?: string;
  };

export interface SeedMenuPizzaPrice extends Sourced {
  chain: string;
  sizeLabel: string;
  crustName: string;
  toppingCount: number | null;
  menuPriceUsd: number;
}

export interface SeedComponentValue extends Sourced {
  chain: string;
  category: string;
  descriptor: string;
  menuPriceUsd: number;
}

export interface SeedDeliveryFee extends Sourced {
  chain: string;
  feeUsd: number;
}

export interface SeedPizzaItem {
  quantity?: number;
  sizeLabel: string;
  crustName: string;
  toppingCount: number | null;
  toppingPolicy?: ToppingPolicy;
  premiumToppings?: boolean;
}

export interface SeedOtherItem {
  quantity?: number;
  category: string;
  descriptor: string;
}

export interface SeedDeal extends Sourced {
  chain: string;
  dealName: string;
  kind: DealKind;
  fulfillment: Fulfillment;
  priceUsd: number | null;
  discountPercent?: number | null;
  discountScope?: DiscountScope | null;
  promoCode?: string | null;
  validThrough?: string | null;
  pizzaItems: SeedPizzaItem[];
  otherItems?: SeedOtherItem[];
}

export interface SeedDataset {
  /** The market every price in this dataset was captured for (D5). */
  pricingLocale: string;
  capturedAt: string;
  chains: SeedChain[];
  crusts: SeedCrust[];
  sizes: SeedSize[];
  menuPizzaPrices: SeedMenuPizzaPrice[];
  componentValues: SeedComponentValue[];
  deliveryFees: SeedDeliveryFee[];
  deals: SeedDeal[];
}
