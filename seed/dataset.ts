import type { SeedDataset } from './types';

/**
 * Seed dataset — captured 2026-07-31.
 *
 * ============================ READ THIS BEFORE TRUSTING A NUMBER ============================
 *
 * Every row here is `manual_secondary`: hand-entered from third-party coupon and
 * menu-listing sites, NOT from the chains' own pages. The build environment cannot reach
 * dominos.com, pizzahut.com, or papajohns.com — the network policy denies those hosts —
 * so nothing in this file has been verified against a primary source.
 *
 * That matters more than usual for this project. Collecting these rows reproduced the
 * exact failure the brief predicted: two secondary sources returned in the same search
 * gave Papa John's large as 14" and as ~13.5". They cannot both be right, and a 0.5"
 * difference is ~7.8% of the pizza — larger than the gap between many of the deals we
 * are ranking. See the Papa John's Large entry in `sizes` for how that conflict is
 * recorded.
 *
 * So: this dataset exists to give the UI real-shaped data to be built and validated
 * against, and to exercise every path through the normalization module with offers that
 * actually resemble what the chains run. It is not a source of truth about prices, and
 * the UI must render its `manual_secondary` provenance visibly. The Domino's scraper
 * (step 3) replaces these rows with `scraped` ones.
 *
 * Prices are also franchise-variable — several sources note that explicitly — which is
 * why every price is scoped to one market (D5).
 * ===========================================================================================
 */

const CAPTURED_AT = '2026-07-31';

// Sources consulted, kept as constants so each row can point at the one it came from.
const SRC = {
  dominosDeals: 'https://www.dominos.com/en/pages/order/#!/section/Coupons/',
  dominosKcl: 'https://thekrazycouponlady.com/tips/store-hacks/dominos-pizza-deals',
  dominosSlickdeals:
    'https://slickdeals.net/f/18429868-domino-s-pizza-9-99-large-any-crust-any-toppings-pizza-up-to-7-toppings-july-7-aug-3',
  dominosCoupons: 'https://www.coupons.com/coupon-codes/dominos',
  pizzaHutDeals: 'https://www.pizzahut.com/deals',
  pizzaHutMenupedia: 'https://menupedia.us/pizza-hut-menu/',
  pizzaHutBigDinnerBox: 'https://pizzahutmenu.us/pizza-huts-big-dinner-box-menu/',
  pizzaHutDealnews: 'https://www.dealnews.com/s1337/Pizza-Hut/',
  papaJohnsDeals: 'https://www.papajohns.com/order/deals',
  papaJohnsMenus: 'https://papajohns-menus.us/',
  papaJohnsEatDrinkDeals: 'https://www.eatdrinkdeals.com/papa-johns-specials-deals/',
  papaJohnsSlice: 'https://www.slicepizzeria.com/papa-johns-pizza-sizes/',
  papaJohnsFoodBlogAlliance: 'https://foodblogalliance.com/how-many-inches-is-a-large-papa-johns-pizza/',
} as const;

export const seedDataset: SeedDataset = {
  pricingLocale: 'san-diego-ca',
  capturedAt: CAPTURED_AT,

  chains: [
    {
      slug: 'dominos',
      displayName: "Domino's",
      menuUrl: 'https://www.dominos.com/en/pages/order/menu',
      dealsUrl: SRC.dominosDeals,
    },
    {
      slug: 'pizza_hut',
      displayName: 'Pizza Hut',
      menuUrl: 'https://www.pizzahut.com/menu',
      dealsUrl: SRC.pizzaHutDeals,
    },
    {
      slug: 'papa_johns',
      displayName: "Papa John's",
      menuUrl: 'https://www.papajohns.com/order/menu',
      dealsUrl: SRC.papaJohnsDeals,
    },
  ],

  crusts: [
    // Domino's
    {
      chain: 'dominos',
      name: 'Hand Tossed',
      crustClass: 'standard',
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
    },
    {
      chain: 'dominos',
      name: 'Crunchy Thin',
      crustClass: 'thin',
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
    },
    {
      chain: 'dominos',
      name: 'Brooklyn Style',
      crustClass: 'specialty',
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
      note: 'Specialty class but not necessarily upcharged — the two are independent, which is why crust_class and observed_upcharge_usd are separate columns.',
    },
    {
      chain: 'dominos',
      name: 'Handmade Pan',
      crustClass: 'specialty',
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
      note: 'Size availability for this crust is unverified and deliberately not asserted; the scraper must read it from the ordering page.',
    },

    // Pizza Hut
    {
      chain: 'pizza_hut',
      name: 'Hand Tossed',
      crustClass: 'standard',
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },
    {
      chain: 'pizza_hut',
      name: 'Thin N Crispy',
      crustClass: 'thin',
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },
    {
      chain: 'pizza_hut',
      name: 'Tavern',
      crustClass: 'thin',
      sourceUrl: SRC.pizzaHutDealnews,
      provenance: 'manual_secondary',
      note: 'Classed as thin on the basis of how it is described rather than a chain statement. Worth confirming when the scraper lands.',
    },
    {
      chain: 'pizza_hut',
      name: 'Original Pan',
      crustClass: 'specialty',
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },
    {
      chain: 'pizza_hut',
      name: 'Stuffed Crust',
      crustClass: 'specialty',
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },

    // Papa John's
    {
      chain: 'papa_johns',
      name: 'Original',
      crustClass: 'standard',
      sourceUrl: SRC.papaJohnsMenus,
      provenance: 'manual_secondary',
    },
    {
      chain: 'papa_johns',
      name: 'Thin',
      crustClass: 'thin',
      sourceUrl: SRC.papaJohnsMenus,
      provenance: 'manual_secondary',
    },
    {
      chain: 'papa_johns',
      name: 'Epic Stuffed Crust',
      crustClass: 'specialty',
      sourceUrl: SRC.papaJohnsMenus,
      provenance: 'manual_secondary',
    },
  ],

  sizes: [
    // Domino's
    {
      chain: 'dominos',
      sizeLabel: 'Small',
      shape: 'round',
      diameterIn: 10,
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
    },
    {
      chain: 'dominos',
      sizeLabel: 'Medium',
      shape: 'round',
      diameterIn: 12,
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
    },
    {
      chain: 'dominos',
      sizeLabel: 'Large',
      shape: 'round',
      diameterIn: 14,
      sourceUrl: SRC.dominosDeals,
      provenance: 'manual_secondary',
    },

    // Pizza Hut
    {
      chain: 'pizza_hut',
      sizeLabel: 'Medium',
      shape: 'round',
      diameterIn: 12,
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },
    {
      chain: 'pizza_hut',
      sizeLabel: 'Large',
      shape: 'round',
      diameterIn: 14,
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },

    // Papa John's — the conflict the brief warned about, recorded rather than resolved.
    {
      chain: 'papa_johns',
      sizeLabel: 'Medium',
      shape: 'round',
      diameterIn: 12,
      sourceUrl: SRC.papaJohnsSlice,
      provenance: 'manual_secondary',
    },
    {
      chain: 'papa_johns',
      sizeLabel: 'Large',
      shape: 'round',
      diameterIn: 13.5,
      sourceUrl: SRC.papaJohnsFoodBlogAlliance,
      provenance: 'manual_secondary',
      note:
        'DISPUTED. Two secondary sources returned in the same search disagree: ' +
        `${SRC.papaJohnsSlice} states 14", ${SRC.papaJohnsFoodBlogAlliance} states ~13.5" ` +
        'for Original Crust. 13.5" is used here as the more specific claim, but the gap is ' +
        '~7.8% of the pizza and swings cost per in² by more than the difference between ' +
        'several ranked deals. This single row is the strongest argument for scraping ' +
        'diameter from the chain rather than trusting any reference table.',
    },
  ],

  menuPizzaPrices: [
    {
      chain: 'pizza_hut',
      sizeLabel: 'Large',
      crustName: 'Stuffed Crust',
      toppingCount: 1,
      menuPriceUsd: 17.99,
      sourceUrl: SRC.pizzaHutBigDinnerBox,
      provenance: 'manual_secondary',
    },
    {
      chain: 'papa_johns',
      sizeLabel: 'Large',
      crustName: 'Epic Stuffed Crust',
      toppingCount: 1,
      menuPriceUsd: 15.19,
      sourceUrl: SRC.papaJohnsMenus,
      provenance: 'manual_secondary',
      note: 'Needed to price the 30%-off Epic Stuffed Crust offer under D6.',
    },
  ],

  componentValues: [
    {
      chain: 'pizza_hut',
      category: 'wings',
      descriptor: 'Wings, 8 pc',
      menuPriceUsd: 10.99,
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
      note: 'Source quotes $10.99 per order for Buffalo / Honey BBQ / Garlic Parmesan; it does not state whether that is the bone-in or boneless price. Applied to the boneless wings in the Big Dinner Box, which may overstate the credit.',
    },
  ],

  /**
   * Empty on purpose. No delivery fee could be sourced for any of the three chains
   * without reaching their checkout flows, and inventing one would corrupt the D1 toggle
   * — the toggle silently does nothing rather than showing a made-up number.
   */
  deliveryFees: [],

  deals: [
    // ---------------------------------------------------------------- Domino's
    {
      chain: 'dominos',
      dealName: 'Large 3-Topping Carryout',
      kind: 'single_pizza',
      fulfillment: 'carryout',
      priceUsd: 7.99,
      pizzaItems: [{ sizeLabel: 'Large', crustName: 'Hand Tossed', toppingCount: 3 }],
      sourceUrl: SRC.dominosKcl,
      provenance: 'manual_secondary',
      note: 'Advertised as Monday–Thursday only. Day-of-week restrictions are not modeled; the schema has valid_from/valid_through but no recurring-day concept.',
    },
    {
      chain: 'dominos',
      dealName: 'Mix & Match — 2 or more items at $6.99 each',
      kind: 'multi_pizza',
      fulfillment: 'delivery',
      priceUsd: 13.98,
      pizzaItems: [
        { quantity: 2, sizeLabel: 'Medium', crustName: 'Hand Tossed', toppingCount: 2 },
      ],
      sourceUrl: SRC.dominosCoupons,
      provenance: 'manual_secondary',
      note: 'Advertised per item ($6.99 each, minimum 2). Modeled as the 2-pizza combination at $13.98; the UI must show the chain\'s per-item phrasing alongside our figure.',
    },
    {
      chain: 'dominos',
      dealName: '$9.99 Large, Any Crust, Any Toppings (up to 7)',
      kind: 'single_pizza',
      fulfillment: 'carryout',
      priceUsd: 9.99,
      validThrough: '2026-08-03',
      pizzaItems: [
        {
          sizeLabel: 'Large',
          crustName: 'Hand Tossed',
          toppingCount: 7,
          toppingPolicy: 'up_to',
        },
      ],
      sourceUrl: SRC.dominosSlickdeals,
      provenance: 'manual_secondary',
      note: 'Offer states "any crust", so thin and specialty variants exist at the same price — meaning the specialty premium is zero for this offer. Only the standard hand-tossed variant is modeled, because which crusts qualify was not verifiable from a secondary source. This is a genuine modeling gap: see the report.',
    },
    {
      chain: 'dominos',
      dealName: '50% off menu-priced pizzas',
      kind: 'single_pizza',
      fulfillment: 'delivery',
      priceUsd: null,
      discountPercent: 50,
      discountScope: 'pizza',
      validThrough: '2026-08-02',
      pizzaItems: [{ sizeLabel: 'Large', crustName: 'Hand Tossed', toppingCount: 1 }],
      sourceUrl: SRC.dominosCoupons,
      provenance: 'manual_secondary',
      note: 'Deliberately seeded without a menu price: no Domino\'s à-la-carte price could be sourced. Exercises the D6 refusal path — the deal is stored and shown, but marked unrankable rather than given a guessed price.',
    },

    // --------------------------------------------------------------- Pizza Hut
    {
      chain: 'pizza_hut',
      dealName: 'Big Dinner Box',
      kind: 'bundle',
      fulfillment: 'carryout',
      priceUsd: 21.99,
      pizzaItems: [{ quantity: 2, sizeLabel: 'Medium', crustName: 'Hand Tossed', toppingCount: 1 }],
      otherItems: [
        { quantity: 5, category: 'breadsticks', descriptor: 'Breadstick' },
        { category: 'wings', descriptor: 'Wings, 8 pc' },
      ],
      sourceUrl: SRC.pizzaHutBigDinnerBox,
      provenance: 'manual_secondary',
      note: 'Sources give a range of $21.99–$24.99 depending on market and upgrades; the low end is used. Breadsticks have no sourced à-la-carte price, so this imputes partially — which is the honest outcome and a useful UI case.',
    },
    {
      chain: 'pizza_hut',
      dealName: '$7 Deal Lover\'s — 2 or more items at $7 each',
      kind: 'multi_pizza',
      fulfillment: 'carryout',
      priceUsd: 14.0,
      pizzaItems: [{ quantity: 2, sizeLabel: 'Medium', crustName: 'Hand Tossed', toppingCount: 1 }],
      sourceUrl: SRC.pizzaHutMenupedia,
      provenance: 'manual_secondary',
    },
    {
      chain: 'pizza_hut',
      dealName: 'Large Tavern Recipe',
      kind: 'single_pizza',
      fulfillment: 'carryout',
      priceUsd: 12.0,
      pizzaItems: [{ sizeLabel: 'Large', crustName: 'Tavern', toppingCount: 1 }],
      sourceUrl: SRC.pizzaHutDealnews,
      provenance: 'manual_secondary',
      note: 'Advertised "as low as $12", so this is a floor price rather than a fixed one.',
    },

    // ------------------------------------------------------------- Papa John's
    {
      chain: 'papa_johns',
      dealName: '30% off Large 1-Topping Epic Stuffed Crust',
      kind: 'single_pizza',
      fulfillment: 'delivery',
      priceUsd: null,
      discountPercent: 30,
      discountScope: 'pizza',
      pizzaItems: [{ sizeLabel: 'Large', crustName: 'Epic Stuffed Crust', toppingCount: 1 }],
      sourceUrl: SRC.papaJohnsEatDrinkDeals,
      provenance: 'manual_secondary',
      note: 'Priced under D6 from the $15.19 Epic Stuffed Crust menu price. Note this deal sits on the disputed 13.5"/14" Large — its cost per in² inherits that uncertainty.',
    },
    {
      chain: 'papa_johns',
      dealName: 'Two Medium 2-Topping Pizzas, $6 each',
      kind: 'multi_pizza',
      fulfillment: 'delivery',
      priceUsd: 12.0,
      pizzaItems: [{ quantity: 2, sizeLabel: 'Medium', crustName: 'Original', toppingCount: 2 }],
      sourceUrl: SRC.papaJohnsEatDrinkDeals,
      provenance: 'manual_secondary',
    },
    {
      chain: 'papa_johns',
      dealName: 'Large 2-Topping + 6pc Wings + 2-Liter',
      kind: 'bundle',
      fulfillment: 'delivery',
      priceUsd: 22.0,
      pizzaItems: [{ sizeLabel: 'Large', crustName: 'Original', toppingCount: 2 }],
      otherItems: [
        { category: 'wings', descriptor: 'Wings, 6 pc' },
        { category: 'drink', descriptor: '2-liter soda' },
      ],
      sourceUrl: SRC.papaJohnsEatDrinkDeals,
      provenance: 'manual_secondary',
      note: 'No à-la-carte price could be sourced for either component, so this bundle cannot be imputed at all. Exercises the BUNDLE_NOT_IMPUTED path: shown at full price with the reason stated, rather than pretending the sides are free.',
    },
  ],
};
