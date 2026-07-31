import type {
  CrustClass,
  DealKind,
  DiscountScope,
  Fulfillment,
  ToppingPolicy,
} from '@/lib/normalize/types';

/**
 * The snapshot file format — this app's database.
 *
 * Each daily scrape writes one JSON file into `data/snapshots/`. Git supplies what
 * Postgres would have: history, diffs, and an audit trail of exactly what changed and
 * when. There is no server at read time, so the build reads the newest snapshot and
 * bakes it in.
 *
 * What this format has to preserve that a naive "dump today's deals" would lose:
 * `firstSeen` across days, price history when an offer's price moves, and the last known
 * good data for a chain whose scraper broke. Those are the reasons the merge step exists.
 */

export const SNAPSHOT_VERSION = 1 as const;

export type Provenance = 'scraped' | 'manual_primary' | 'manual_secondary';

export interface SnapshotPizzaItem {
  quantity: number;
  sizeLabel: string;
  shape: 'round' | 'rect';
  diameterIn?: number;
  lengthIn?: number;
  widthIn?: number;
  crustName: string;
  crustClass: CrustClass;
  toppingCount: number | null;
  toppingPolicy: ToppingPolicy;
  premiumToppings: boolean;
  menuPriceUsd: number | null;
}

export interface SnapshotOtherItem {
  quantity: number;
  category: string;
  descriptor: string;
  menuPriceUsd: number | null;
}

export interface PriceObservation {
  observedAt: string;
  priceUsd: number | null;
  discountPercent: number | null;
}

export interface SnapshotDeal {
  /** Stable identity across days. Excludes price, so a price change is not a new deal. */
  fingerprint: string;
  chain: string;
  dealName: string;
  kind: DealKind;
  fulfillment: Fulfillment;
  priceUsd: number | null;
  discountPercent: number | null;
  discountScope: DiscountScope | null;
  promoCode: string | null;
  validThrough: string | null;
  sourceUrl: string;
  pizzaItems: SnapshotPizzaItem[];
  otherItems: SnapshotOtherItem[];
  provenance: Provenance;
  notes: string[];

  firstSeen: string;
  lastSeen: string;
  /** When a scrape last confirmed this offer still exists. Drives the stale indicator. */
  lastVerifiedAt: string;
  active: boolean;
  stale: boolean;
  priceHistory: PriceObservation[];
}

export interface SnapshotSize {
  chain: string;
  sizeLabel: string;
  shape: 'round' | 'rect';
  diameterIn?: number;
  lengthIn?: number;
  widthIn?: number;
  sourceUrl: string;
  provenance: Provenance;
  note?: string;
}

export interface SnapshotCrust {
  chain: string;
  crustName: string;
  crustClass: CrustClass;
  availableDiametersIn: number[];
  sourceUrl: string;
  provenance: Provenance;
  note?: string;
}

export interface SnapshotComponentValue {
  chain: string;
  category: string;
  descriptor: string;
  menuPriceUsd: number;
  sourceUrl: string;
  provenance: Provenance;
  note?: string;
}

export interface SnapshotDeliveryFee {
  chain: string;
  feeUsd: number;
  sourceUrl: string;
  provenance: Provenance;
}

export interface ChainSnapshotStatus {
  chain: string;
  displayName: string;
  status: 'ok' | 'partial' | 'failed';
  /** Last time this chain's scrape produced usable data. Null if it never has. */
  lastSuccessfulAt: string | null;
  errors: string[];
  /** Offers seen but not understood, carried through so they are reviewable. */
  unparsed: { raw: string; reason: string }[];
}

export interface SnapshotChain {
  slug: string;
  displayName: string;
  menuUrl: string;
  dealsUrl: string;
}

export interface Snapshot {
  version: typeof SNAPSHOT_VERSION;
  capturedAt: string;
  pricingLocale: string;
  chains: SnapshotChain[];
  chainStatus: ChainSnapshotStatus[];
  sizes: SnapshotSize[];
  crusts: SnapshotCrust[];
  componentValues: SnapshotComponentValue[];
  deliveryFees: SnapshotDeliveryFee[];
  deals: SnapshotDeal[];
}
