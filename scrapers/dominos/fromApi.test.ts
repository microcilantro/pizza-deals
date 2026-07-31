import { describe, expect, it } from 'vitest';
import type { StoreMenuResponse } from './api';
import { dealsFromCoupons, menuPricesFromVariants, sizesFromMenu } from './fromApi';

/**
 * Fixtures below are transcribed from a real payload, captured by the API probe against
 * the live San Diego store. The size names, variant naming convention, and coupon field
 * shapes are what Domino's actually returns — not a reconstruction.
 */

const SOURCE = 'https://order.dominos.com/power/store/1234/menu';

const MENU: StoreMenuResponse = {
  Sizes: {
    Pizza: {
      '10': { Code: '10', Name: 'Small (10")' },
      '12': { Code: '12', Name: 'Medium (12")' },
      '14': { Code: '14', Name: 'Large (14")' },
      '16': { Code: '16', Name: 'X-Large (16")' },
    },
    // Non-pizza categories have no diameter and must be ignored.
    Bread: { BRD8: { Code: 'BRD8', Name: '8-Piece' } },
    CHARGES: { CHGONE: { Code: 'CHGONE', Name: 'Each' } },
  } as never,
  Variants: {
    P12ITHCK: { Name: 'Medium (12") Thin Crust Memphis BBQ Chicken', Price: '20.99', SizeCode: '12' },
    P10IRECZ: { Name: 'Small (10") Hand Tossed Wisconsin 6-Cheese Pizza', Price: '17.99', SizeCode: '10' },
    PINPASCA: { Name: 'Chicken Alfredo Pasta', Price: '9.99', SizeCode: '' },
  },
  Coupons: {},
};

describe('sizesFromMenu', () => {
  it('reads diameters the chain states itself', () => {
    const sizes = sizesFromMenu(MENU, SOURCE);
    expect(sizes).toEqual([
      { sizeLabel: 'Small', shape: 'round', diameterIn: 10, sourceUrl: SOURCE },
      { sizeLabel: 'Medium', shape: 'round', diameterIn: 12, sourceUrl: SOURCE },
      { sizeLabel: 'Large', shape: 'round', diameterIn: 14, sourceUrl: SOURCE },
      { sizeLabel: 'X-Large', shape: 'round', diameterIn: 16, sourceUrl: SOURCE },
    ]);
  });

  it('ignores categories that have no diameter', () => {
    // Bread comes in "8-Piece", which is not a size in inches.
    const labels = sizesFromMenu(MENU, SOURCE).map((s) => s.sizeLabel);
    expect(labels).not.toContain('8-Piece');
    expect(labels).not.toContain('Each');
  });

  it('returns nothing rather than guessing when the payload has no sizes', () => {
    expect(sizesFromMenu({}, SOURCE)).toEqual([]);
  });
});

describe('menuPricesFromVariants', () => {
  it('takes pizza variants with their crust and price', () => {
    const prices = menuPricesFromVariants(MENU, SOURCE);
    expect(prices).toContainEqual({
      sizeLabel: 'Medium',
      crustName: 'Crunchy Thin',
      toppingCount: null,
      menuPriceUsd: 20.99,
      sourceUrl: SOURCE,
    });
  });

  it('skips non-pizza variants, which state no diameter', () => {
    expect(menuPricesFromVariants(MENU, SOURCE).map((p) => p.menuPriceUsd)).not.toContain(9.99);
  });
});

/* --------------------------------------------------------------------- coupons */

const coupon = (over: Record<string, unknown> = {}) => ({
  Name: 'Large 3-Topping Pizza',
  Description: 'Large 3-topping pizza.',
  Price: '7.99',
  ValidServiceMethods: ['Carryout'],
  Local: false,
  ...over,
});

const withCoupons = (coupons: Record<string, unknown>): StoreMenuResponse => ({
  ...MENU,
  Coupons: coupons as never,
});

describe('dealsFromCoupons', () => {
  it('turns a coupon into a deal with the coupon code as the promo code', () => {
    const { deals } = dealsFromCoupons(withCoupons({ '9193': coupon() }), SOURCE);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      dealName: 'Large 3-Topping Pizza',
      fulfillment: 'carryout',
      priceUsd: 7.99,
      promoCode: '9193',
    });
    expect(deals[0]!.pizzaItems[0]).toMatchObject({ sizeLabel: 'Large', toppingCount: 3 });
  });

  it('emits one deal per service method, since they are separate rows', () => {
    const { deals } = dealsFromCoupons(
      withCoupons({ '9193': coupon({ ValidServiceMethods: ['Delivery', 'Carryout'] }) }),
      SOURCE,
    );
    expect(deals).toHaveLength(2);
    expect(deals.map((d) => d.fulfillment).sort()).toEqual(['carryout', 'delivery']);
  });

  it('ignores the Local flag, which every store-menu coupon carries', () => {
    // Local:true does not mean "store-specific promotion" — the menu is store-scoped by
    // construction, so the flag is set on plainly national offers too. Filtering on it
    // discarded 17 of 21 real coupons.
    const { deals } = dealsFromCoupons(withCoupons({ '9193': coupon({ Local: true }) }), SOURCE);
    expect(deals).toHaveLength(1);
  });

  it('excludes offers the comparison market does not also run', () => {
    const { deals, unparsed } = dealsFromCoupons(
      withCoupons({ '9193': coupon(), LOCALONLY: coupon({ Name: 'Large 3-Topping Pizza' }) }),
      SOURCE,
      { nationalCodes: new Set(['9193']) },
    );
    expect(deals.map((d) => d.promoCode)).toEqual(['9193']);
    expect(unparsed[0]!.reason).toMatch(/not offered in the comparison market/i);
  });

  it('skips the national check when no comparison codes are supplied', () => {
    const { deals } = dealsFromCoupons(withCoupons({ '9193': coupon() }), SOURCE);
    expect(deals).toHaveLength(1);
  });

  it('falls back to the offer text when the service-method field is empty', () => {
    // Real coupons routinely leave ValidServiceMethods empty and say so in their copy.
    const { deals } = dealsFromCoupons(
      withCoupons({
        '5057': coupon({
          Name: '1 Large 3 Topping Pizza – Carryout Only',
          Description: '',
          ValidServiceMethods: [],
        }),
      }),
      SOURCE,
    );
    expect(deals).toHaveLength(1);
    expect(deals[0]!.fulfillment).toBe('carryout');
  });

  it('treats an unrestricted offer as orderable both ways, and says so', () => {
    // Silence is not ambiguity here: a coupon that names no service method carries no
    // restriction, so it is available either way. Refusing these cost 11 real deals.
    const { deals } = dealsFromCoupons(
      withCoupons({
        '9193': coupon({ Description: 'Great value all week.', ValidServiceMethods: [] }),
      }),
      SOURCE,
    );
    expect(deals.map((d) => d.fulfillment).sort()).toEqual(['carryout', 'delivery']);
    for (const deal of deals) {
      expect(deal.notes.join(' ')).toMatch(/states no carryout\/delivery restriction/i);
    }
  });

  it('does not add the inference note when the method was actually stated', () => {
    const { deals } = dealsFromCoupons(withCoupons({ '9193': coupon() }), SOURCE);
    expect(deals[0]!.notes.join(' ')).not.toMatch(/no carryout\/delivery restriction/i);
  });

  it('does not report the same rejection once per service method', () => {
    // A wings coupon has no pizza, so it is rejected — but only once.
    const { deals, unparsed } = dealsFromCoupons(
      withCoupons({
        '8118': coupon({
          Name: '16 Piece Parmesan or Garlic Bread Bites and a 2-Liter',
          Description: '16 piece bread bites and a 2-liter.',
          Price: '8.99',
          ValidServiceMethods: ['Delivery', 'Carryout'],
        }),
      }),
      SOURCE,
    );
    expect(deals).toHaveLength(0);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]!.reason).toMatch(/does not appear to contain a pizza/i);
  });

  it('keeps the parser\'s refusal reasons intact', () => {
    const { unparsed } = dealsFromCoupons(
      withCoupons({ ABC: coupon({ Name: 'Any pizza deal', Description: 'Great value.', Price: null }) }),
      SOURCE,
    );
    expect(unparsed[0]!.reason).toMatch(/no price or percentage discount/i);
  });

  it('handles an empty coupon section without throwing', () => {
    expect(dealsFromCoupons({}, SOURCE)).toEqual({ deals: [], unparsed: [] });
  });

  it('processes a realistic mixed batch', () => {
    const { deals, unparsed } = dealsFromCoupons(
      withCoupons({
        '9193': coupon(),
        '5152': coupon({
          Name: 'Mix & Match',
          Description: '2 or more items at $6.99 each. Medium 2-topping pizzas.',
          Price: '6.99',
          ValidServiceMethods: ['Delivery'],
        }),
        '8118': coupon({
          Name: '16 Piece Bread Bites and a 2-Liter',
          Description: 'Bread bites and a 2-liter.',
          Price: '8.99',
          ValidServiceMethods: ['Carryout'],
        }),
      }),
      SOURCE,
    );

    expect(deals.map((d) => d.dealName).sort()).toEqual(['Large 3-Topping Pizza', 'Mix & Match']);
    // Per-item pricing is multiplied out by the shared parser.
    expect(deals.find((d) => d.dealName === 'Mix & Match')).toMatchObject({
      kind: 'multi_pizza',
      priceUsd: 13.98,
    });
    expect(unparsed).toHaveLength(1); // the bread bites, which contain no pizza
  });
});
