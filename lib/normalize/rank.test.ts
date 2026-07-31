import { describe, expect, it } from 'vitest';
import { crust, deal, pizza, round, side } from './__fixtures__';
import { rankDeals } from './rank';

const handTossed = crust('Hand Tossed', 'standard');
const stuffed = crust('Stuffed Crust', 'specialty');

describe('rankDeals', () => {
  it('orders a segment by cost per square inch, cheapest first', () => {
    const deals = [
      deal({ chain: 'pizza_hut', priceUsd: 12.99, pizzaItems: [pizza({ shape: round(14) })] }),
      deal({ chain: 'dominos', priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] }),
      deal({ chain: 'papa_johns', priceUsd: 10.99, pizzaItems: [pizza({ shape: round(13.5) })] }),
    ];

    const { segments } = rankDeals(deals);
    expect(segments).toHaveLength(1);

    const ranked = segments[0]!.deals;
    expect(ranked.map((r) => r.deal.chain)).toEqual(['dominos', 'papa_johns', 'pizza_hut']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('splits crust classes, fulfillment, and bundles into separate segments', () => {
    const deals = [
      deal({ pizzaItems: [pizza({ crust: handTossed })] }),
      deal({ pizzaItems: [pizza({ crust: stuffed })] }),
      deal({ fulfillment: 'delivery', pizzaItems: [pizza({ crust: handTossed })] }),
      deal({
        kind: 'bundle',
        priceUsd: 19.99,
        pizzaItems: [pizza({ crust: handTossed })],
        otherItems: [side('Breadsticks', 6.99)],
      }),
    ];

    const { segments } = rankDeals(deals);
    expect(segments).toHaveLength(4);
    expect(segments.every((s) => s.deals.length === 1)).toBe(true);
  });

  it('gives every segment a readable label', () => {
    const { segments } = rankDeals([deal({ pizzaItems: [pizza({ crust: stuffed })] })]);
    expect(segments[0]!.label).toBe('Specialty crust, carryout, pizza only');
  });

  it('never lets a bundle outrank a pure-pizza deal, however cheap the imputation makes it', () => {
    const cheapImputedBundle = deal({
      chain: 'dominos',
      kind: 'bundle',
      priceUsd: 19.99,
      pizzaItems: [pizza({ shape: round(12), quantity: 2 })],
      otherItems: [side('Breadsticks', 6.99), side('2-liter soda', 3.49)],
    });
    const plainLarge = deal({
      chain: 'pizza_hut',
      priceUsd: 9.99,
      pizzaItems: [pizza({ shape: round(14) })],
    });

    const { segments } = rankDeals([cheapImputedBundle, plainLarge]);
    const tracks = segments.map((s) => s.segment.track);
    expect(new Set(tracks)).toEqual(new Set(['pizza', 'bundle']));

    // The bundle's imputed metric is genuinely better, and it still does not appear
    // in the pizza-only list.
    const pizzaSegment = segments.find((s) => s.segment.track === 'pizza')!;
    expect(pizzaSegment.deals).toHaveLength(1);
    expect(pizzaSegment.deals[0]!.deal.chain).toBe('pizza_hut');
  });

  it('collects unrankable deals with the reason attached rather than dropping them', () => {
    const mixedCrust = deal({
      kind: 'multi_pizza',
      pizzaItems: [pizza({ crust: handTossed }), pizza({ crust: stuffed })],
    });
    const noMenuPrice = deal({
      priceUsd: null,
      discountPercent: 50,
      discountScope: 'pizza',
      pizzaItems: [pizza({ menuPriceUsd: null })],
    });
    const good = deal({ priceUsd: 9.99 });

    const { segments, ungrouped } = rankDeals([mixedCrust, noMenuPrice, good]);

    expect(segments.flatMap((s) => s.deals)).toHaveLength(1);
    expect(ungrouped).toHaveLength(2);
    expect(ungrouped.every((u) => u.metrics.warnings.length > 0)).toBe(true);
    expect(ungrouped.flatMap((u) => u.metrics.warnings.map((w) => w.code))).toEqual(
      expect.arrayContaining(['MIXED_CRUST_CLASS', 'MISSING_MENU_PRICE']),
    );
  });

  it('ranks a derived percentage-off price alongside advertised prices', () => {
    const advertised = deal({
      chain: 'dominos',
      priceUsd: 9.99,
      pizzaItems: [pizza({ shape: round(14) })],
    });
    const percentOff = deal({
      chain: 'papa_johns',
      priceUsd: null,
      discountPercent: 50,
      discountScope: 'pizza',
      pizzaItems: [pizza({ shape: round(14), menuPriceUsd: 16.99 })],
    });

    const { segments } = rankDeals([advertised, percentOff]);
    const ranked = segments[0]!.deals;

    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.deal.chain).toBe('papa_johns');
    expect(ranked[0]!.metrics.pricingBasis).toBe('derived_from_discount');
  });

  it('reorders results when the delivery-fee toggle changes', () => {
    const cheapWithBigFee = deal({
      chain: 'dominos',
      fulfillment: 'delivery',
      priceUsd: 9.99,
      pizzaItems: [pizza({ shape: round(14) })],
    });
    const dearerWithNoFee = deal({
      chain: 'pizza_hut',
      fulfillment: 'delivery',
      priceUsd: 11.99,
      pizzaItems: [pizza({ shape: round(14) })],
    });
    const deals = [cheapWithBigFee, dearerWithNoFee];
    const fees = { dominos: 5.99, pizza_hut: 0 };

    const sticker = rankDeals(deals, { deliveryFees: fees });
    expect(sticker.segments[0]!.deals[0]!.deal.chain).toBe('dominos');

    const withFees = rankDeals(deals, { includeDeliveryFee: true, deliveryFees: fees });
    expect(withFees.segments[0]!.deals[0]!.deal.chain).toBe('pizza_hut');
  });

  it('separates size compositions in strict mode that area mode groups', () => {
    const deals = [
      deal({ chain: 'dominos', priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] }),
      deal({
        chain: 'pizza_hut',
        kind: 'multi_pizza',
        priceUsd: 13.99,
        pizzaItems: [pizza({ shape: round(12), quantity: 2 })],
      }),
    ];

    expect(rankDeals(deals, { comparability: 'area' }).segments).toHaveLength(1);
    expect(rankDeals(deals, { comparability: 'strict' }).segments).toHaveLength(2);
  });

  it('breaks ties deterministically so the list does not shuffle between loads', () => {
    const a = deal({ chain: 'pizza_hut', priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] });
    const b = deal({ chain: 'dominos', priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] });

    const first = rankDeals([a, b]).segments[0]!.deals.map((r) => r.deal.chain);
    const second = rankDeals([b, a]).segments[0]!.deals.map((r) => r.deal.chain);
    expect(first).toEqual(second);
    expect(first).toEqual(['dominos', 'pizza_hut']);
  });

  it('returns empty results for empty input', () => {
    const { segments, ungrouped } = rankDeals([]);
    expect(segments).toEqual([]);
    expect(ungrouped).toEqual([]);
  });
});
