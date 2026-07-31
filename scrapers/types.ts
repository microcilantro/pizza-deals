import type {
  CrustClass,
  DealKind,
  DiscountScope,
  Fulfillment,
  ToppingPolicy,
} from '@/lib/normalize/types';

/**
 * Contracts shared by every chain scraper.
 *
 * Scrapers produce rows and nothing else. They never compute a metric, never decide
 * comparability, never touch the normalization module. That separation is what keeps
 * three chains from growing three subtly different definitions of value.
 */

/** A size the chain sells, read from its own menu — never from a reference table. */
export interface ScrapedSize {
  sizeLabel: string;
  shape: 'round' | 'rect';
  diameterIn?: number;
  lengthIn?: number;
  widthIn?: number;
  sourceUrl: string;
}

export interface ScrapedCrust {
  crustName: string;
  crustClass: CrustClass;
  /** Diameters this crust is orderable in. Requirement 2: crust constrains size. */
  availableDiametersIn: number[];
  sourceUrl: string;
}

export interface ScrapedMenuPrice {
  sizeLabel: string;
  crustName: string;
  toppingCount: number | null;
  menuPriceUsd: number;
  sourceUrl: string;
}

export interface ScrapedPizzaItem {
  quantity: number;
  sizeLabel: string;
  crustName: string;
  toppingCount: number | null;
  toppingPolicy: ToppingPolicy;
}

export interface ScrapedOtherItem {
  quantity: number;
  category: string;
  descriptor: string;
}

export interface ScrapedDeal {
  dealName: string;
  kind: DealKind;
  fulfillment: Fulfillment;
  priceUsd: number | null;
  discountPercent: number | null;
  discountScope: DiscountScope | null;
  promoCode: string | null;
  validThrough: string | null;
  pizzaItems: ScrapedPizzaItem[];
  otherItems: ScrapedOtherItem[];
  sourceUrl: string;
  /** Anything the parser could not resolve, carried through for review. */
  notes: string[];
}

export type ScrapeStatus = 'ok' | 'partial' | 'failed';

export interface ScrapeResult {
  chain: string;
  status: ScrapeStatus;
  startedAt: Date;
  finishedAt: Date;
  sizes: ScrapedSize[];
  crusts: ScrapedCrust[];
  menuPrices: ScrapedMenuPrice[];
  deals: ScrapedDeal[];
  /** Offers seen but not understood. Loud, not silent — these are the ones to look at. */
  unparsed: { raw: string; reason: string }[];
  errors: string[];
  screenshotPaths: string[];
}

/**
 * Raw text pulled off the page before any interpretation. Keeping this as an explicit
 * intermediate matters: the DOM selectors that produce it can only be verified against
 * the live site, but everything downstream of it is pure and testable against the real
 * strings the chain advertises.
 */
export interface RawDealCard {
  title: string;
  description: string;
  priceText: string | null;
  promoCode: string | null;
  fulfillmentText: string | null;
  validThroughText: string | null;
  sourceUrl: string;
}

export interface RawMenuSize {
  label: string;
  /** e.g. "14\"" or "Large 14 inch" — parsed downstream. */
  descriptionText: string;
  priceText: string | null;
  crustText: string | null;
}
