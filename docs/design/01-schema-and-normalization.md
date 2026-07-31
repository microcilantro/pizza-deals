# Design proposal: schema + normalization module

Status: **proposed, awaiting review.** Nothing below is implemented yet.

This covers step 1 of the build order (schema + normalization signatures). Open
questions are collected at the bottom; several of them change the schema, so they are
worth resolving before any DDL lands.

---

## 0. Infrastructure picks

**Postgres: Neon.** Three reasons that actually matter here:

- Scale-to-zero fits the load shape. This app is a daily cron write plus low-volume
  reads. Supabase's Postgres is always-on; we would pay for idle.
- Database branching gives us a throwaway copy per migration/scraper change. Scrapers
  are the part most likely to write garbage, and being able to run one against a branch
  before touching production is worth more than anything else on offer.
- The HTTP serverless driver avoids connection-pool exhaustion between Vercel's SSR
  lambdas and the cron job without bolting on a pooler.

Supabase's differentiators are auth, realtime, storage, and row-level security. This app
has no users, no auth, and one writer. We would be adopting a platform for features we
never use.

**ORM: Drizzle.** SQL-native (this schema has CHECK constraints and generated columns
that are awkward to express in Prisma), no query-engine binary to cold-start in a
lambda, and it composes cleanly with the Neon HTTP driver.

---

## 1. Schema

> The DDL below is the narrative version, kept for the reasoning around it. Once
> implemented, `db/schema.ts` is authoritative and this section may lag it. Decisions
> D1–D6 in §4 are reflected in the implementation.

The one structural decision that drives everything else: **a deal is not a row with a
pizza in it.** "Two mediums plus breadsticks and a 2-liter" does not fit a flat table —
you cannot put two diameters in one `size_diameter_in` column. So the model is
offer → line items.

The suggested field list in the brief is preserved, but distributed across the right
tables.

### 1.1 Reference / scraped-fact tables

These exist so that no diameter or crust rule is ever hardcoded (requirement 1 and 2).
Everything here is *observed*, timestamped, and attributed to a source URL.

```sql
create type crust_class   as enum ('standard', 'thin', 'specialty');
create type fulfillment   as enum ('carryout', 'delivery');
create type deal_kind     as enum ('single_pizza', 'multi_pizza', 'bundle');
create type pizza_shape   as enum ('round', 'rect');
create type topping_policy as enum ('exact', 'up_to', 'unlimited', 'specialty_fixed');
create type scrape_status as enum ('ok', 'partial', 'failed');

create table chains (
  id            serial primary key,
  slug          text not null unique,          -- 'dominos' | 'pizza_hut' | 'papa_johns'
  display_name  text not null,
  menu_url      text not null,
  deals_url     text not null
);

-- Chain-specific crust catalog. Crust is a first-class dimension, not a size modifier.
create table crust_options (
  id                    serial primary key,
  chain_id              int  not null references chains(id),
  crust_name            text not null,          -- as the chain names it
  crust_class           crust_class not null,
  observed_upcharge_usd numeric(6,2),           -- nullable: often not separately priced
  source_url            text not null,
  first_seen            timestamptz not null default now(),
  last_seen             timestamptz not null default now(),
  unique (chain_id, crust_name)
);

-- Requirement 2, encoded: which diameters a crust is even orderable in.
create table crust_size_availability (
  crust_option_id int not null references crust_options(id),
  diameter_in     numeric(4,2) not null,
  orderable       boolean not null,
  source_url      text not null,
  observed_at     timestamptz not null default now(),
  primary key (crust_option_id, diameter_in)
);

-- Requirement 1, encoded: size labels resolve to observed diameters, never to a
-- hardcoded table. Crust-scoped because some chains size differently per crust.
create table size_observations (
  id              serial primary key,
  chain_id        int  not null references chains(id),
  size_label      text not null,                -- 'Large', 'XL', 'Medium'
  crust_option_id int references crust_options(id),  -- null = applies to all crusts
  shape           pizza_shape not null default 'round',
  diameter_in     numeric(4,2),
  length_in       numeric(4,2),
  width_in        numeric(4,2),
  source_url      text not null,
  observed_at     timestamptz not null default now(),
  constraint dims_match_shape check (
    (shape = 'round' and diameter_in is not null and length_in is null and width_in is null)
    or
    (shape = 'rect'  and diameter_in is null and length_in is not null and width_in is not null)
  )
);

-- Observed delivery fees, per decision D1. Kept as observations rather than a column
-- on chains because fees move and we want the history.
create table delivery_fee_observations (
  id          serial primary key,
  chain_id    int  not null references chains(id),
  fee_usd     numeric(6,2) not null,
  source_url  text not null,
  observed_at timestamptz not null default now()
);

-- À-la-carte menu prices, used to impute pizza-only value out of bundles (req. 4).
create table component_values (
  id            serial primary key,
  chain_id      int  not null references chains(id),
  category      text not null,      -- 'breadsticks' | 'wings' | 'soda_2l' | 'dessert' | ...
  descriptor    text not null,      -- 'Stuffed Cheesy Bread, 8pc'
  menu_price_usd numeric(6,2) not null,
  source_url    text not null,
  observed_at   timestamptz not null default now()
);
```

Note `size_observations.shape`. Pizza Hut sells a rectangular Detroit-style pizza, so
diameter is not universal. The primary metric is area, and diameter is only one way to
get there — the schema reflects that rather than forcing a fake diameter.

### 1.2 Deals

```sql
create table deals (
  id              serial primary key,
  chain_id        int  not null references chains(id),
  fingerprint     text not null,          -- stable identity, see below
  deal_name       text not null,
  kind            deal_kind not null,
  fulfillment     fulfillment not null,   -- requirement 5: separate rows, never merged
  price_usd       numeric(6,2) not null,
  promo_code      text,
  valid_from      date,
  valid_through   date,
  source_url      text not null,
  national        boolean not null default true,
  -- lifecycle
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  active          boolean not null default true,
  stale           boolean not null default false,
  unique (chain_id, fingerprint)
);

create table deal_pizza_items (
  id                serial primary key,
  deal_id           int not null references deals(id) on delete cascade,
  quantity          int not null default 1,
  size_label        text not null,           -- kept for display: "Large" as advertised
  shape             pizza_shape not null default 'round',
  diameter_in       numeric(4,2),
  length_in         numeric(4,2),
  width_in          numeric(4,2),
  size_observation_id int references size_observations(id),  -- provenance for the diameter
  crust_option_id   int not null references crust_options(id),
  topping_count     int,
  topping_policy    topping_policy not null default 'exact',
  premium_toppings  boolean not null default false,
  constraint dims_match_shape check (
    (shape = 'round' and diameter_in is not null)
    or
    (shape = 'rect'  and length_in is not null and width_in is not null)
  )
);

create table deal_other_items (
  id          serial primary key,
  deal_id     int not null references deals(id) on delete cascade,
  quantity    int not null default 1,
  category    text not null,
  descriptor  text not null,
  component_value_id int references component_values(id)  -- how we priced it
);

-- Price history, so a price change is an update to a deal rather than a new deal.
create table deal_price_history (
  deal_id     int not null references deals(id) on delete cascade,
  price_usd   numeric(6,2) not null,
  observed_at timestamptz not null default now(),
  primary key (deal_id, observed_at)
);

-- Scraper health, feeding the UI stale indicator.
create table scrape_runs (
  id            serial primary key,
  chain_id      int not null references chains(id),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        scrape_status not null,
  deals_found   int,
  error_message text,
  screenshot_path text
);
```

Three things in there are deliberate and worth flagging:

**`fingerprint` excludes price.** It hashes (chain, normalized deal name, fulfillment,
sorted item signature). If Domino's moves the $9.99 deal to $10.99, that is the same
deal at a new price — `first_seen` should not reset. Price movement goes to
`deal_price_history`. Folding price into identity would silently destroy the history we
most want.

**`kind` replaces a bare `is_bundle` flag.** The brief's field list collapses two
different things. "Two mediums, no sides" is a multi-pizza deal, not a bundle — it needs
no imputation and belongs in the pure-pizza ranking, just with summed area. "One large +
breadsticks" is a bundle. `is_bundle` is recoverable as `kind = 'bundle'`, defined as
*has at least one non-pizza item*.

**`stale` is a flag on the row, not a deletion.** Requirement from the scraper spec: a
parse failure keeps last known good data and marks it stale. `last_verified_at` drives
it.

---

## 2. Normalization module

One module, `lib/normalize/`. Pure functions — no DB access, no chain-specific branches,
no I/O. Scrapers produce rows; this module reads rows and produces metrics. That is the
only way the "never duplicate per chain" rule survives contact with three scrapers.

```
lib/normalize/
  geometry.ts     area math
  metrics.ts      cost per in², cost per topping slot
  bundles.ts      pizza-only imputation
  comparability.ts  who may be ranked against whom
  rank.ts         sorting + segmentation
  types.ts
```

### 2.1 Types

```ts
export type Shape =
  | { kind: 'round'; diameterIn: number }
  | { kind: 'rect';  lengthIn: number; widthIn: number };

export interface PizzaItem {
  quantity: number;
  shape: Shape;
  sizeLabel: string;              // display only — never used in comparisons
  crust: { name: string; class: CrustClass };
  toppingCount: number | null;
  toppingPolicy: ToppingPolicy;
  premiumToppings: boolean;
}

export interface OtherItem {
  quantity: number;
  category: string;
  descriptor: string;
  menuPriceUsd: number | null;    // null = we could not price it
}

export interface Deal {
  id: number;
  chain: string;
  dealName: string;
  kind: DealKind;
  fulfillment: Fulfillment;
  priceUsd: number;
  pizzaItems: PizzaItem[];
  otherItems: OtherItem[];
  promoCode: string | null;
  sourceUrl: string;
  stale: boolean;
  lastVerifiedAt: Date;
}
```

### 2.2 Signatures

```ts
// geometry.ts
export function areaSqIn(shape: Shape): number;
export function totalPizzaAreaSqIn(items: PizzaItem[]): number;   // respects quantity

// bundles.ts
export interface Imputation {
  pizzaOnlyPriceUsd: number;
  creditedUsd: number;                  // value subtracted for non-pizza items
  uncreditedItems: OtherItem[];         // items we could not price
  confidence: 'exact' | 'partial' | 'none';
}
export function imputePizzaOnlyPrice(deal: Deal, opts: NormalizationOptions): Imputation;

// metrics.ts
export type MetricBasis = 'as_advertised' | 'imputed_pizza_only';

export interface Assumption {
  code: string;                         // 'BUNDLE_CREDIT' | 'UNPRICED_COMPONENT' | ...
  message: string;                      // rendered verbatim in the UI
}

export interface NormalizationOptions {
  componentValues: ComponentValueLookup;
  deliveryFees: DeliveryFeeLookup;
  includeDeliveryFee: boolean;          // D1: default false, UI toggle
  componentCreditFactor: number;        // D4: default 1.0 (full menu price)
  comparability: ComparabilityMode;     // D3: default 'area'
}

export interface DealMetrics {
  totalAreaSqIn: number;
  effectivePriceUsd: number;            // includes delivery fee only when D1 toggle is on
  costPerSqIn: number;
  basis: MetricBasis;
  costPerToppingSlot: number | null;    // null when policy is 'unlimited'
  comparabilityKey: string;
  segment: Segment;                     // which ranking track this belongs to
  assumptions: Assumption[];
  warnings: string[];                   // data-quality, e.g. crust/size not orderable
}
export function computeDealMetrics(deal: Deal, opts: NormalizationOptions): DealMetrics;

// comparability.ts
export interface Segment {
  crustClass: CrustClass;
  fulfillment: Fulfillment;
  kind: DealKind;
  areaProfile: string;                  // e.g. '12.00x2' — sorted diameter multiset
}
export function comparabilityKey(deal: Deal): string;
export function canCompare(a: Deal, b: Deal, mode: ComparabilityMode): boolean;

// rank.ts
export interface RankedDeal { deal: Deal; metrics: DealMetrics; rank: number; }
export function rankDeals(deals: Deal[], opts: NormalizationOptions): {
  segments: Map<string, RankedDeal[]>;
  ungrouped: RankedDeal[];              // deals we refused to rank, with reasons
};
```

`Assumption[]` is on the return type, not a side channel. Every number the UI shows can
be traced to the assumptions that produced it, which is the "surface the assumption
rather than hiding it" requirement made structural instead of aspirational.

### 2.3 Worked example — why bundle imputation must be visible

Deal A: $9.99, large carryout, 3 toppings, hand tossed, 14".
Deal B: $19.99, two mediums (12") + breadsticks + a 2-liter, carryout.

```
A: area = π·7²          = 153.94 in²  →  9.99 / 153.94  = $0.0649 / in²
B: area = 2·(π·6²)      = 226.19 in²  →  19.99 / 226.19 = $0.0884 / in²   (as advertised)
B: credit breadsticks $6.99 + 2-liter $3.49 = $10.48
   → pizza-only $9.51  →  9.51 / 226.19     = $0.0420 / in²   (imputed)
```

Deal B is either 36% worse than A or 35% better, entirely depending on an assumption the
user cannot see. That is the whole product. Both numbers should be reachable in the UI,
with the imputed one labeled and the credited components itemized.

Guardrails in `imputePizzaOnlyPrice`: credit is clamped so the imputed pizza price can
never fall to or below zero, and any component we could not find an à-la-carte price for
is returned in `uncreditedItems` and downgrades `confidence` — it does not silently
count as $0.

---

## 3. Edge cases where the chains do not fit the model

Flagging these now rather than discovering them in step 5.

1. **Rectangular pizza.** Pizza Hut's Detroit-style is not round. Handled above via
   `shape`, but it means diameter can never be the schema's primary key for size — area
   is. Any UI filter labeled "size" has to filter on area or on label, not diameter.
2. **"Premium" crust and "upcharged" crust are different things.** Some specialty crusts
   carry no upcharge at all, while some standard crusts do at certain sizes. So
   `crust_class` (taxonomy) and `observed_upcharge_usd` (price fact) are stored
   separately, and neither is derived from the other.
3. **Thin crust.** Same area as hand-tossed, typically same price, meaningfully less
   food. Cost per in² cannot see the difference. It is not premium and it is not
   equivalent to standard — hence a third class (D2).
4. **Unlimited-topping deals.** "Any pizza, any toppings, $X" has no topping count.
   `topping_policy = 'unlimited'` and `costPerToppingSlot` returns null rather than
   dividing by a guess.
5. **Premium toppings that count double.** Chains count some meats as two topping slots.
   `premiumToppings` records it; the secondary metric is unreliable across chains
   regardless, which is part of why it stays secondary.
6. **Deals that are only a discount, not a price.** "50% off online orders" has no
   absolute price. Resolved by D6: priced from the scraped base menu price, flagged as
   derived. Unrankable only when the menu price cannot be found.
7. **Mix-and-match tiers.** "$6.99 each when you buy 2+" is per-item pricing with a
   quantity gate. Representable as a multi-pizza deal at $13.98, but the advertised unit
   is different from the modeled unit, so the UI must show the chain's phrasing verbatim
   alongside our number.
8. **Mixed-crust-class deals.** A two-pizza deal where the customer picks crust per
   pizza can span crust classes, so the deal has no single class to segment on.
   `rankDeals` refuses these rather than picking one, returning them in `ungrouped` with
   reason `MIXED_CRUST_CLASS`.
9. **Order-level percentage discounts.** "25% off your entire order" applies to pizza
   and non-pizza items together, so the discount and the bundle imputation interact —
   crediting a side at full menu price against a discounted order double-counts.
   `discount_applies_to` records the scope; order-level discounts on bundles are marked
   unrankable in v1 rather than modeled wrong.
10. **National-only discipline.** Chains render prices against a default or geolocated
   store even on national pages. The scraper needs a fixed reference locale so prices
   are consistent day-over-day, and anything the page marks as store-specific gets
   dropped. Worth deciding the reference locale explicitly — see Q4.

---

## 4. Resolved decisions

**D1 — Delivery fees: stored, off by default, UI toggle.** Scrape an observed per-chain
delivery fee into `delivery_fee_observations`. The default ranking uses sticker price so
our numbers match what the chain advertises; an "include delivery fee" toggle recomputes
`effectivePriceUsd` and therefore cost per in². When the toggle is on, the fee is
attributed as an `Assumption` with its source and observation date, since a scraped fee
is a weaker fact than a scraped menu price.

**D2 — Three crust classes:** `standard` / `thin` / `specialty`. Thin is its own
segment and its own filter chip, never ranked against hand-tossed.

**D3 — Area-based ranking by default, strict matching as a filter.** The headline list
ranks on cost per in² within (crust class × fulfillment), regardless of how the area is
composed, and every row displays its size mix so a 2×12" deal is visibly distinct from a
1×14" one. `ComparabilityMode = 'area' | 'strict'`; `'strict'` additionally requires an
identical diameter multiset and is exposed as a "like-for-like only" filter.

**D4 — Bundle components credited at full à-la-carte menu price.**
`componentCreditFactor` defaults to `1.0` and is configurable. This is the only figure we
can source and cite. It is generous to bundles, so the itemized credit is always shown —
the UI lists each component and the menu price used, per the worked example above.

**D5 — Reference market: San Diego, CA.** All scraping runs against one fixed San Diego
locale, recorded per row in `pricing_locale`. Prices are labeled in the UI as reference
pricing for that market, with a link out to the chain so a user can confirm at their own
store. No per-user ZIP entry: it would force request-time scraping of three chains per
page view, and it would change the product's claim from "what the national deals are
worth" to "what your local store charges." `pricing_locale` exists on every priced row
so that adding markets later is a new dimension rather than a migration of every row.

**D6 — Percentage-off deals are priced from the scraped menu.** "50% off all pizzas"
has no advertised dollar amount, but we already scrape each chain's menu for diameters
and component values. Capturing base pizza menu prices too makes these deals rankable:
50% off a $16.99 large is $8.50, with real area behind it. Priced this way they carry
`pricing_basis = 'derived_from_discount'` and an assumption naming the menu price used.
If the menu price is missing, the deal is unrankable rather than guessed.

## 5. Still open

Nothing blocking. Items deferred by decision: per-market pricing beyond San Diego (D5),
and order-level percentage discounts that span pizza and non-pizza items (see edge case
9 below).

---

## 6. What happens after review

Unchanged from the agreed build order — schema and normalization land first with unit
tests covering the bundle and premium-crust cases above, then the seed data, then
Domino's, then UI.
