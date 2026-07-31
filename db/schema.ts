import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Schema notes
 *
 * The single structural decision here: a deal is an *offer* composed of line items, not
 * a row with one pizza in it. "Two mediums plus breadsticks and a 2-liter" has two
 * diameters and two non-pizza components; there is nowhere to put them in a flat table.
 *
 * Everything that could be a hardcoded fact about a chain (diameters, which crusts come
 * in which sizes, side prices, delivery fees) is instead an observation row carrying a
 * source URL and a timestamp. Chains change sizing; a reference table would silently go
 * stale, and we would not be able to tell when it did.
 */

export const crustClassEnum = pgEnum('crust_class', ['standard', 'thin', 'specialty']);
export const fulfillmentEnum = pgEnum('fulfillment', ['carryout', 'delivery']);
export const dealKindEnum = pgEnum('deal_kind', ['single_pizza', 'multi_pizza', 'bundle']);
export const pizzaShapeEnum = pgEnum('pizza_shape', ['round', 'rect']);
export const toppingPolicyEnum = pgEnum('topping_policy', [
  'exact',
  'up_to',
  'unlimited',
  'specialty_fixed',
]);
export const pricingBasisEnum = pgEnum('pricing_basis', ['advertised', 'derived_from_discount']);
export const discountScopeEnum = pgEnum('discount_scope', ['pizza', 'order']);
export const scrapeStatusEnum = pgEnum('scrape_status', ['ok', 'partial', 'failed']);

/**
 * Where a fact came from, and therefore how much to trust it.
 *
 * `scraped` is read by our own scraper from the chain's own page — the only provenance
 * the app should ultimately rely on. `manual_primary` is hand-entered from the chain's
 * own page. `manual_secondary` is hand-entered from a third party (a coupon aggregator,
 * a menu-listing site); these disagree with each other constantly, especially on
 * diameters, so rows carrying it must be visibly marked in the UI and are seed data at
 * best.
 */
export const provenanceEnum = pgEnum('provenance', [
  'scraped',
  'manual_primary',
  'manual_secondary',
]);

/** D5: every priced row records the market it was observed in. */
export const DEFAULT_PRICING_LOCALE = 'san-diego-ca';

export const chains = pgTable('chains', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  menuUrl: text('menu_url').notNull(),
  dealsUrl: text('deals_url').notNull(),
});

/**
 * Crust is a first-class dimension, not a modifier on size (requirement 2).
 *
 * crustClass and observedUpchargeUsd are deliberately independent: some specialty
 * crusts carry no upcharge, and some standard crusts do at certain sizes. Deriving
 * either from the other would be wrong in both directions.
 */
export const crustOptions = pgTable(
  'crust_options',
  {
    id: serial('id').primaryKey(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    crustName: text('crust_name').notNull(),
    crustClass: crustClassEnum('crust_class').notNull(),
    observedUpchargeUsd: numeric('observed_upcharge_usd', { precision: 6, scale: 2 }),
    provenance: provenanceEnum('provenance').notNull().default('scraped'),
    provenanceNote: text('provenance_note'),
    sourceUrl: text('source_url').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainCrust: unique('crust_options_chain_name_uq').on(t.chainId, t.crustName),
  }),
);

/** Requirement 2, encoded: which diameters a given crust is even orderable in. */
export const crustSizeAvailability = pgTable(
  'crust_size_availability',
  {
    id: serial('id').primaryKey(),
    crustOptionId: integer('crust_option_id')
      .notNull()
      .references(() => crustOptions.id),
    diameterIn: numeric('diameter_in', { precision: 4, scale: 2 }).notNull(),
    orderable: boolean('orderable').notNull(),
    provenance: provenanceEnum('provenance').notNull().default('scraped'),
    provenanceNote: text('provenance_note'),
    sourceUrl: text('source_url').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    crustDiameter: unique('crust_size_availability_uq').on(t.crustOptionId, t.diameterIn),
  }),
);

/**
 * Requirement 1, encoded: size labels resolve to *observed* diameters. Never compare on
 * labels, and never hardcode the mapping — "large" is not a constant across chains and
 * is not even a constant within a chain over time.
 *
 * Crust-scoped because some chains size differently per crust. Shape-aware because not
 * every pizza is round (Pizza Hut sells a rectangular Detroit-style).
 */
export const sizeObservations = pgTable(
  'size_observations',
  {
    id: serial('id').primaryKey(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    sizeLabel: text('size_label').notNull(),
    crustOptionId: integer('crust_option_id').references(() => crustOptions.id),
    shape: pizzaShapeEnum('shape').notNull().default('round'),
    diameterIn: numeric('diameter_in', { precision: 4, scale: 2 }),
    lengthIn: numeric('length_in', { precision: 4, scale: 2 }),
    widthIn: numeric('width_in', { precision: 4, scale: 2 }),
    provenance: provenanceEnum('provenance').notNull().default('scraped'),
    provenanceNote: text('provenance_note'),
    sourceUrl: text('source_url').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dimsMatchShape: check(
      'size_observations_dims_match_shape',
      sql`(${t.shape} = 'round' AND ${t.diameterIn} IS NOT NULL AND ${t.lengthIn} IS NULL AND ${t.widthIn} IS NULL)
          OR (${t.shape} = 'rect' AND ${t.diameterIn} IS NULL AND ${t.lengthIn} IS NOT NULL AND ${t.widthIn} IS NOT NULL)`,
    ),
  }),
);

/**
 * Base à-la-carte pizza prices (D6). Needed to price percentage-off offers, which carry
 * no dollar amount of their own.
 */
export const menuPizzaPrices = pgTable('menu_pizza_prices', {
  id: serial('id').primaryKey(),
  chainId: integer('chain_id')
    .notNull()
    .references(() => chains.id),
  sizeLabel: text('size_label').notNull(),
  crustOptionId: integer('crust_option_id')
    .notNull()
    .references(() => crustOptions.id),
  toppingCount: integer('topping_count'),
  menuPriceUsd: numeric('menu_price_usd', { precision: 6, scale: 2 }).notNull(),
  pricingLocale: text('pricing_locale').notNull().default(DEFAULT_PRICING_LOCALE),
  provenance: provenanceEnum('provenance').notNull().default('scraped'),
  provenanceNote: text('provenance_note'),
  sourceUrl: text('source_url').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
});

/** À-la-carte prices for sides and drinks, used to impute pizza-only value (req. 4). */
export const componentValues = pgTable('component_values', {
  id: serial('id').primaryKey(),
  chainId: integer('chain_id')
    .notNull()
    .references(() => chains.id),
  category: text('category').notNull(),
  descriptor: text('descriptor').notNull(),
  menuPriceUsd: numeric('menu_price_usd', { precision: 6, scale: 2 }).notNull(),
  pricingLocale: text('pricing_locale').notNull().default(DEFAULT_PRICING_LOCALE),
  provenance: provenanceEnum('provenance').notNull().default('scraped'),
  provenanceNote: text('provenance_note'),
  sourceUrl: text('source_url').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * D1: delivery fees are observations rather than a column on `chains`, because fees move
 * and the history is worth keeping. Off by default in the ranking; the UI exposes a
 * toggle.
 */
export const deliveryFeeObservations = pgTable('delivery_fee_observations', {
  id: serial('id').primaryKey(),
  chainId: integer('chain_id')
    .notNull()
    .references(() => chains.id),
  feeUsd: numeric('fee_usd', { precision: 6, scale: 2 }).notNull(),
  pricingLocale: text('pricing_locale').notNull().default(DEFAULT_PRICING_LOCALE),
  provenance: provenanceEnum('provenance').notNull().default('scraped'),
  provenanceNote: text('provenance_note'),
  sourceUrl: text('source_url').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `fingerprint` deliberately excludes price: it hashes (chain, normalized name,
 * fulfillment, item signature). When a $9.99 deal becomes $10.99 that is the same deal
 * at a new price, and `firstSeen` must not reset. Price movement goes to
 * dealPriceHistory. Folding price into identity would destroy the history we most want.
 *
 * `stale` is a flag, never a delete: a scraper parse failure keeps the last known good
 * row and marks it, per the scraper spec.
 */
export const deals = pgTable(
  'deals',
  {
    id: serial('id').primaryKey(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    fingerprint: text('fingerprint').notNull(),
    dealName: text('deal_name').notNull(),
    kind: dealKindEnum('kind').notNull(),
    /** Requirement 5: carryout and delivery are separate rows, never merged. */
    fulfillment: fulfillmentEnum('fulfillment').notNull(),

    priceUsd: numeric('price_usd', { precision: 6, scale: 2 }),
    /** D6: percentage-only offers carry no advertised price. */
    discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }),
    discountScope: discountScopeEnum('discount_scope'),
    pricingLocale: text('pricing_locale').notNull().default(DEFAULT_PRICING_LOCALE),

    promoCode: text('promo_code'),
    validFrom: date('valid_from'),
    validThrough: date('valid_through'),
    provenance: provenanceEnum('provenance').notNull().default('scraped'),
    provenanceNote: text('provenance_note'),
    sourceUrl: text('source_url').notNull(),
    national: boolean('national').notNull().default(true),

    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
    active: boolean('active').notNull().default(true),
    stale: boolean('stale').notNull().default(false),
  },
  (t) => ({
    chainFingerprint: unique('deals_chain_fingerprint_uq').on(t.chainId, t.fingerprint),
    priceOrDiscount: check(
      'deals_price_or_discount',
      sql`${t.priceUsd} IS NOT NULL OR ${t.discountPercent} IS NOT NULL`,
    ),
    discountScopeSet: check(
      'deals_discount_scope_set',
      sql`${t.discountPercent} IS NULL OR ${t.discountScope} IS NOT NULL`,
    ),
  }),
);

export const dealPizzaItems = pgTable(
  'deal_pizza_items',
  {
    id: serial('id').primaryKey(),
    dealId: integer('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    /** Kept for display only — the label is what the chain advertises, never a comparison key. */
    sizeLabel: text('size_label').notNull(),
    shape: pizzaShapeEnum('shape').notNull().default('round'),
    diameterIn: numeric('diameter_in', { precision: 4, scale: 2 }),
    lengthIn: numeric('length_in', { precision: 4, scale: 2 }),
    widthIn: numeric('width_in', { precision: 4, scale: 2 }),
    /** Provenance: which observation justified the diameter above. */
    sizeObservationId: integer('size_observation_id').references(() => sizeObservations.id),
    crustOptionId: integer('crust_option_id')
      .notNull()
      .references(() => crustOptions.id),
    /** D6: which menu price a percentage discount was applied to. */
    menuPriceId: integer('menu_price_id').references(() => menuPizzaPrices.id),
    toppingCount: integer('topping_count'),
    toppingPolicy: toppingPolicyEnum('topping_policy').notNull().default('exact'),
    premiumToppings: boolean('premium_toppings').notNull().default(false),
  },
  (t) => ({
    dimsMatchShape: check(
      'deal_pizza_items_dims_match_shape',
      sql`(${t.shape} = 'round' AND ${t.diameterIn} IS NOT NULL)
          OR (${t.shape} = 'rect' AND ${t.lengthIn} IS NOT NULL AND ${t.widthIn} IS NOT NULL)`,
    ),
    positiveQuantity: check('deal_pizza_items_qty_positive', sql`${t.quantity} > 0`),
  }),
);

export const dealOtherItems = pgTable('deal_other_items', {
  id: serial('id').primaryKey(),
  dealId: integer('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull().default(1),
  category: text('category').notNull(),
  descriptor: text('descriptor').notNull(),
  /** How we priced it for bundle imputation; null means we could not. */
  componentValueId: integer('component_value_id').references(() => componentValues.id),
});

export const dealPriceHistory = pgTable('deal_price_history', {
  id: serial('id').primaryKey(),
  dealId: integer('deal_id')
    .notNull()
    .references(() => deals.id, { onDelete: 'cascade' }),
  priceUsd: numeric('price_usd', { precision: 6, scale: 2 }),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Scraper health, feeding the UI's per-chain stale indicator. */
export const scrapeRuns = pgTable('scrape_runs', {
  id: serial('id').primaryKey(),
  chainId: integer('chain_id')
    .notNull()
    .references(() => chains.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: scrapeStatusEnum('status').notNull(),
  dealsFound: integer('deals_found'),
  errorMessage: text('error_message'),
  screenshotPath: text('screenshot_path'),
});

export const chainsRelations = relations(chains, ({ many }) => ({
  deals: many(deals),
  crustOptions: many(crustOptions),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  chain: one(chains, { fields: [deals.chainId], references: [chains.id] }),
  pizzaItems: many(dealPizzaItems),
  otherItems: many(dealOtherItems),
  priceHistory: many(dealPriceHistory),
}));

export const dealPizzaItemsRelations = relations(dealPizzaItems, ({ one }) => ({
  deal: one(deals, { fields: [dealPizzaItems.dealId], references: [deals.id] }),
  crust: one(crustOptions, {
    fields: [dealPizzaItems.crustOptionId],
    references: [crustOptions.id],
  }),
  menuPrice: one(menuPizzaPrices, {
    fields: [dealPizzaItems.menuPriceId],
    references: [menuPizzaPrices.id],
  }),
}));

export const dealOtherItemsRelations = relations(dealOtherItems, ({ one }) => ({
  deal: one(deals, { fields: [dealOtherItems.dealId], references: [deals.id] }),
  componentValue: one(componentValues, {
    fields: [dealOtherItems.componentValueId],
    references: [componentValues.id],
  }),
}));
