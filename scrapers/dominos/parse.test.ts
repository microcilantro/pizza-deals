import { describe, expect, it } from 'vitest';
import type { RawDealCard } from '../types';
import {
  parseCrust,
  parseDealCard,
  parseDiameterIn,
  parseDiscountPercent,
  parseFulfillment,
  parsePriceUsd,
  parsePromoCode,
  parseQuantity,
  parseRectDimensions,
  parseSides,
  parseSizeLabel,
  parseToppings,
  parseValidThrough,
} from './parse';

/**
 * These tests run against Domino's real advertising copy, collected while building the
 * seed dataset. That matters: the DOM selectors feeding this parser are unverified
 * guesses, but the strings below are what the chain actually writes, so these
 * assertions stay meaningful even after a site redesign breaks every selector.
 */

describe('parsePriceUsd', () => {
  it('reads a plain price', () => {
    expect(parsePriceUsd('$7.99')).toBe(7.99);
    expect(parsePriceUsd('$12')).toBe(12);
  });

  it('takes the price, not the quantity, from per-item copy', () => {
    // The bug this guards: "2 or more" leading the string yields 2, not 6.99.
    expect(parsePriceUsd('2 or more items at $6.99 each')).toBe(6.99);
  });

  it('handles a price embedded in a title', () => {
    expect(parsePriceUsd('$9.99 Large, Any Crust, Any Toppings')).toBe(9.99);
  });

  it('returns null when there is no price', () => {
    expect(parsePriceUsd('50% off all pizzas')).toBeNull();
    expect(parsePriceUsd(null)).toBeNull();
    expect(parsePriceUsd('')).toBeNull();
  });
});

describe('parseDiscountPercent', () => {
  it('reads percentage offers', () => {
    expect(parseDiscountPercent('50% off menu-priced pizzas')).toBe(50);
    expect(parseDiscountPercent('Get 20 % off your order')).toBe(20);
  });

  it('ignores percentages that are not discounts', () => {
    expect(parseDiscountPercent('100% real cheese')).toBeNull();
    expect(parseDiscountPercent('now 15% bigger')).toBeNull();
  });
});

describe('parseSizeLabel', () => {
  it('reads the sizes Domino\'s advertises', () => {
    expect(parseSizeLabel('Large 3-Topping Pizza')).toBe('Large');
    expect(parseSizeLabel('Medium 2-Topping')).toBe('Medium');
    expect(parseSizeLabel('Small cheese pizza')).toBe('Small');
  });

  it('normalizes XL to X-Large', () => {
    expect(parseSizeLabel('XL Pizza Deal')).toBe('X-Large');
    expect(parseSizeLabel('X-Large 2-Topping')).toBe('X-Large');
  });

  it('returns null when no size is stated', () => {
    expect(parseSizeLabel('Mix & Match 2 or More')).toBeNull();
  });
});

describe('parseCrust', () => {
  it('maps crust names to classes', () => {
    expect(parseCrust('Hand Tossed')).toEqual({ name: 'Hand Tossed', crustClass: 'standard' });
    expect(parseCrust('Crunchy Thin Crust')).toEqual({ name: 'Crunchy Thin', crustClass: 'thin' });
    expect(parseCrust('Brooklyn Style')).toEqual({
      name: 'Brooklyn Style',
      crustClass: 'specialty',
    });
    expect(parseCrust('Handmade Pan')).toEqual({ name: 'Handmade Pan', crustClass: 'specialty' });
  });

  it('returns null when no crust is named', () => {
    expect(parseCrust('Large 3-Topping Pizza')).toBeNull();
  });
});

describe('parseToppings', () => {
  it('reads an exact count', () => {
    expect(parseToppings('Large 3-Topping Pizza')).toEqual({ count: 3, policy: 'exact' });
    expect(parseToppings('2 topping medium')).toEqual({ count: 2, policy: 'exact' });
  });

  it('reads a ceiling', () => {
    expect(parseToppings('up to 7 toppings')).toEqual({ count: 7, policy: 'up_to' });
  });

  it('treats "any toppings" as unlimited', () => {
    expect(parseToppings('Any Crust, Any Toppings')).toEqual({ count: null, policy: 'unlimited' });
  });

  it('prefers the stated ceiling over "any" when both appear', () => {
    // Domino's ran exactly this: "Any Toppings Pizza (up to 7 toppings)".
    expect(parseToppings('Any Toppings Pizza up to 7 toppings')).toEqual({
      count: 7,
      policy: 'up_to',
    });
  });

  it('reads a cheese pizza as zero toppings', () => {
    expect(parseToppings('Large cheese pizza')).toEqual({ count: 0, policy: 'exact' });
  });
});

describe('parseFulfillment', () => {
  it('reads carryout and delivery', () => {
    expect(parseFulfillment('Carryout only')).toBe('carryout');
    expect(parseFulfillment('Delivery or carryout', null)).toBe('carryout');
    expect(parseFulfillment('Free delivery')).toBe('delivery');
  });

  it('prefers the more specific carryout signal', () => {
    // "Carryout only. Not valid on delivery." must not read as delivery.
    expect(parseFulfillment('Carryout only. Not valid on delivery orders.')).toBe('carryout');
  });

  it('returns null when neither is stated', () => {
    expect(parseFulfillment('Large 3-Topping Pizza')).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('reads multi-item offers', () => {
    expect(parseQuantity('2 or more items at $6.99 each')).toBe(2);
    expect(parseQuantity('Buy 2 medium pizzas')).toBe(2);
    expect(parseQuantity('Two medium 2-topping pizzas')).toBe(2);
  });

  it('defaults to one', () => {
    expect(parseQuantity('Large 3-Topping Pizza')).toBe(1);
  });
});

describe('parseSides', () => {
  it('finds bundled components', () => {
    const sides = parseSides('Includes bread twists and a 2-liter soda');
    expect(sides.map((s) => s.category)).toEqual(['breadsticks', 'drink']);
  });

  it('captures the wing count in the descriptor', () => {
    const sides = parseSides('Comes with 8 pc wings');
    expect(sides[0]).toMatchObject({ category: 'wings', descriptor: 'Wings, 8 pc' });
  });

  it('does not duplicate a component mentioned twice', () => {
    const sides = parseSides('Bread twists. Yes, bread twists.');
    expect(sides).toHaveLength(1);
  });

  it('returns nothing for a pure pizza offer', () => {
    expect(parseSides('Large 3-Topping Pizza')).toEqual([]);
  });
});

describe('parseValidThrough', () => {
  it('reads several date formats into ISO', () => {
    expect(parseValidThrough('Offer ends 2026-08-03')).toBe('2026-08-03');
    expect(parseValidThrough('Expires 8/3/2026')).toBe('2026-08-03');
    expect(parseValidThrough('Valid through August 3, 2026')).toBe('2026-08-03');
  });

  it('returns null when no date is present', () => {
    expect(parseValidThrough('While supplies last')).toBeNull();
  });
});

describe('parsePromoCode', () => {
  it('reads a code when one is given', () => {
    expect(parsePromoCode('Use code 9193 at checkout')).toBe('9193');
    expect(parsePromoCode('Promo: SAVE20')).toBe('SAVE20');
  });

  it('returns null when there is no code', () => {
    expect(parsePromoCode('No coupon needed')).toBeNull();
  });
});

describe('parseDiameterIn', () => {
  it('reads diameter from the menu row, which is where it must come from', () => {
    expect(parseDiameterIn('Large (14")')).toBe(14);
    expect(parseDiameterIn('14 inch')).toBe(14);
    expect(parseDiameterIn('13.5"')).toBe(13.5);
  });

  it('rejects implausible values rather than trusting them', () => {
    expect(parseDiameterIn('Serves 2" of flavour')).toBeNull();
    expect(parseDiameterIn('100 inches')).toBeNull();
  });

  it('returns null when the menu does not state a size', () => {
    expect(parseDiameterIn('Large')).toBeNull();
  });
});

describe('parseRectDimensions', () => {
  it('reads a rectangular pizza', () => {
    expect(parseRectDimensions('10" x 8"')).toEqual({ lengthIn: 10, widthIn: 8 });
    expect(parseRectDimensions('Detroit style 10x8')).toEqual({ lengthIn: 10, widthIn: 8 });
  });

  it('returns null for a round pizza', () => {
    expect(parseRectDimensions('Large 14"')).toBeNull();
  });
});

/* ------------------------------------------------------------------ whole cards */

const card = (overrides: Partial<RawDealCard> = {}): RawDealCard => ({
  title: 'Large 3-Topping Pizza',
  description: 'Carryout only. Monday through Thursday.',
  priceText: '$7.99',
  promoCode: null,
  fulfillmentText: 'Carryout',
  validThroughText: null,
  sourceUrl: 'https://www.dominos.com/en/pages/order/#!/section/Coupons/',
  ...overrides,
});

describe('parseDealCard', () => {
  it('parses the flagship carryout offer', () => {
    const { deal, unparsed } = parseDealCard(card());
    expect(unparsed).toBeNull();
    expect(deal).toMatchObject({
      dealName: 'Large 3-Topping Pizza',
      kind: 'single_pizza',
      fulfillment: 'carryout',
      priceUsd: 7.99,
      discountPercent: null,
    });
    expect(deal!.pizzaItems[0]).toMatchObject({
      quantity: 1,
      sizeLabel: 'Large',
      crustName: 'Hand Tossed',
      toppingCount: 3,
      toppingPolicy: 'exact',
    });
  });

  it('records that the crust was assumed rather than read', () => {
    const { deal } = parseDealCard(card());
    expect(deal!.notes.join(' ')).toMatch(/assumed Hand Tossed/i);
  });

  it('multiplies per-item pricing out and says it did', () => {
    const { deal } = parseDealCard(
      card({
        title: 'Mix & Match',
        description: '2 or more items at $6.99 each. Medium 2-topping pizzas. Delivery.',
        priceText: '$6.99',
        fulfillmentText: 'Delivery',
      }),
    );
    expect(deal).toMatchObject({ kind: 'multi_pizza', priceUsd: 13.98, fulfillment: 'delivery' });
    expect(deal!.pizzaItems[0]!.quantity).toBe(2);
    expect(deal!.notes.join(' ')).toMatch(/per item at \$6\.99 each/i);
  });

  it('flags an "any crust" offer as having no specialty premium', () => {
    const { deal } = parseDealCard(
      card({
        title: '$9.99 Large, Any Crust, Any Toppings',
        description: 'Up to 7 toppings. Carryout. Offer ends 2026-08-03.',
        priceText: '$9.99',
      }),
    );
    expect(deal!.pizzaItems[0]).toMatchObject({ toppingCount: 7, toppingPolicy: 'up_to' });
    expect(deal!.validThrough).toBe('2026-08-03');
    expect(deal!.notes.join(' ')).toMatch(/specialty premium is zero/i);
  });

  it('parses a percentage offer with no dollar amount', () => {
    const { deal } = parseDealCard(
      card({
        title: '50% off menu-priced pizzas',
        description: 'Large hand tossed. Delivery. Online only.',
        priceText: null,
        fulfillmentText: 'Delivery',
      }),
    );
    expect(deal).toMatchObject({
      priceUsd: null,
      discountPercent: 50,
      discountScope: 'pizza',
    });
  });

  it('builds a bundle when sides are present', () => {
    const { deal } = parseDealCard(
      card({
        title: 'Perfect Combo',
        description: 'Large 2-topping pizza, bread twists and a 2-liter. Delivery.',
        priceText: '$19.99',
        fulfillmentText: 'Delivery',
      }),
    );
    expect(deal!.kind).toBe('bundle');
    expect(deal!.otherItems.map((i) => i.category)).toEqual(['breadsticks', 'drink']);
  });

  it('rejects an offer with neither a price nor a discount', () => {
    const { deal, unparsed } = parseDealCard(card({ priceText: null, title: 'Free delivery week' }));
    expect(deal).toBeNull();
    expect(unparsed!.reason).toMatch(/no price or percentage discount/i);
  });

  it('rejects an offer with no pizza in it', () => {
    const { deal, unparsed } = parseDealCard(
      card({ title: '8 pc Wings', description: 'Carryout.', priceText: '$7.99' }),
    );
    expect(deal).toBeNull();
    expect(unparsed!.reason).toMatch(/does not appear to contain a pizza/i);
  });

  it('rejects an offer whose size it cannot read, rather than guessing one', () => {
    const { deal, unparsed } = parseDealCard(
      card({ title: 'Any pizza deal', description: 'Carryout.', priceText: '$9.99' }),
    );
    expect(deal).toBeNull();
    expect(unparsed!.reason).toMatch(/no size label/i);
  });

  it('rejects an offer that does not say carryout or delivery', () => {
    // These are separate rows by requirement; merging them would be a silent error.
    const { deal, unparsed } = parseDealCard(
      card({ description: 'Limited time only.', fulfillmentText: null }),
    );
    expect(deal).toBeNull();
    expect(unparsed!.reason).toMatch(/carryout vs delivery/i);
  });
});

describe('stuffed crust', () => {
  it('is specialty, not standard', () => {
    // This was a live miss: "Medium 2-Topping Parmesan Stuffed Crust Pizza" was scraped
    // and filed as Hand Tossed, putting a specialty crust in the standard ranking —
    // exactly the comparison error the crust dimension exists to prevent.
    expect(parseCrust('Medium 2-Topping Parmesan Stuffed Crust Pizza')).toEqual({
      name: 'Stuffed Crust',
      crustClass: 'specialty',
    });
    expect(parseCrust('Large Epic Stuffed Crust')).toEqual({
      name: 'Epic Stuffed Crust',
      crustClass: 'specialty',
    });
  });

  it('still reads plain hand tossed as standard', () => {
    expect(parseCrust('Large Hand Tossed Pizza')?.crustClass).toBe('standard');
  });
});
