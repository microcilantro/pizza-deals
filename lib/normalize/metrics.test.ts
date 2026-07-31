import { describe, expect, it } from 'vitest';
import { crust, deal, pizza, rect, round, side } from './__fixtures__';
import { computeDealMetrics } from './metrics';

describe('cost per square inch', () => {
  it('computes the primary metric for a plain carryout deal', () => {
    const metrics = computeDealMetrics(
      deal({ priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] }),
    );
    expect(metrics.costPerSqIn).toBeCloseTo(0.0649, 4);
    expect(metrics.basis).toBe('as_advertised');
    expect(metrics.pricingBasis).toBe('advertised');
    expect(metrics.rankable).toBe(true);
  });

  it('ranks by area, not by sticker price', () => {
    const cheaperSticker = computeDealMetrics(
      deal({ priceUsd: 7.99, pizzaItems: [pizza({ shape: round(10), sizeLabel: 'Small' })] }),
    );
    const dearerSticker = computeDealMetrics(
      deal({ priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] }),
    );
    expect(cheaperSticker.costPerSqIn).toBeGreaterThan(dearerSticker.costPerSqIn);
  });

  it('handles a rectangular pizza without a diameter', () => {
    const metrics = computeDealMetrics(
      deal({
        priceUsd: 12.99,
        pizzaItems: [pizza({ shape: rect(10, 8), sizeLabel: 'Detroit-Style' })],
      }),
    );
    expect(metrics.totalAreaSqIn).toBe(80);
    expect(metrics.costPerSqIn).toBeCloseTo(0.1624, 4);
  });

  it('treats two labels that mean different diameters as different value', () => {
    // "Large" is 14" at one chain and ~13.5" at another. Same label, same price,
    // different deal.
    const fourteen = computeDealMetrics(
      deal({ chain: 'dominos', priceUsd: 11.99, pizzaItems: [pizza({ shape: round(14) })] }),
    );
    const thirteenFive = computeDealMetrics(
      deal({ chain: 'papa_johns', priceUsd: 11.99, pizzaItems: [pizza({ shape: round(13.5) })] }),
    );
    expect(thirteenFive.costPerSqIn).toBeGreaterThan(fourteen.costPerSqIn);
  });
});

describe('percentage-off offers (D6)', () => {
  it('derives a price from the scraped menu price', () => {
    const metrics = computeDealMetrics(
      deal({
        dealName: '50% off pizzas online',
        priceUsd: null,
        discountPercent: 50,
        discountScope: 'pizza',
        pizzaItems: [pizza({ shape: round(14), menuPriceUsd: 16.99 })],
      }),
    );

    expect(metrics.grossPriceUsd).toBeCloseTo(8.5, 2);
    expect(metrics.pricingBasis).toBe('derived_from_discount');
    expect(metrics.rankable).toBe(true);
    expect(metrics.assumptions.some((a) => a.code === 'DERIVED_FROM_DISCOUNT')).toBe(true);
  });

  it('applies the discount across quantity', () => {
    const metrics = computeDealMetrics(
      deal({
        priceUsd: null,
        discountPercent: 25,
        discountScope: 'pizza',
        pizzaItems: [pizza({ shape: round(12), quantity: 2, menuPriceUsd: 14.0 })],
      }),
    );
    expect(metrics.grossPriceUsd).toBeCloseTo(21.0, 2);
  });

  it('refuses to rank when the menu price is missing rather than guessing', () => {
    const metrics = computeDealMetrics(
      deal({
        priceUsd: null,
        discountPercent: 50,
        discountScope: 'pizza',
        pizzaItems: [pizza({ shape: round(14), menuPriceUsd: null })],
      }),
    );
    expect(metrics.rankable).toBe(false);
    expect(metrics.warnings.map((w) => w.code)).toContain('MISSING_MENU_PRICE');
  });

  it('refuses an order-wide discount on a bundle, where credit would double-count', () => {
    const metrics = computeDealMetrics(
      deal({
        kind: 'bundle',
        priceUsd: null,
        discountPercent: 25,
        discountScope: 'order',
        pizzaItems: [pizza({ shape: round(14), menuPriceUsd: 16.99 })],
        otherItems: [side('Breadsticks', 6.99)],
      }),
    );
    expect(metrics.rankable).toBe(false);
    expect(metrics.warnings.map((w) => w.code)).toContain('ORDER_SCOPE_DISCOUNT_ON_BUNDLE');
  });
});

describe('delivery fees (D1)', () => {
  const deliveryDeal = deal({
    fulfillment: 'delivery',
    priceUsd: 9.99,
    pizzaItems: [pizza({ shape: round(14) })],
  });

  it('is excluded by default, so our number matches the advertised one', () => {
    const metrics = computeDealMetrics(deliveryDeal, { deliveryFees: { dominos: 4.99 } });
    expect(metrics.grossPriceUsd).toBeCloseTo(9.99, 2);
    expect(metrics.assumptions.some((a) => a.code === 'DELIVERY_FEE_INCLUDED')).toBe(false);
  });

  it('is added when the toggle is on, and disclosed', () => {
    const metrics = computeDealMetrics(deliveryDeal, {
      includeDeliveryFee: true,
      deliveryFees: { dominos: 4.99 },
    });
    expect(metrics.grossPriceUsd).toBeCloseTo(14.98, 2);
    expect(metrics.costPerSqIn).toBeCloseTo(0.0973, 4);

    const assumption = metrics.assumptions.find((a) => a.code === 'DELIVERY_FEE_INCLUDED');
    expect(assumption?.message).toContain('$4.99');
  });

  it('never touches a carryout row', () => {
    const carryout = deal({ priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] });
    const metrics = computeDealMetrics(carryout, {
      includeDeliveryFee: true,
      deliveryFees: { dominos: 4.99 },
    });
    expect(metrics.grossPriceUsd).toBeCloseTo(9.99, 2);
  });

  it('leaves the price alone when no fee has been observed for the chain', () => {
    const metrics = computeDealMetrics(deliveryDeal, {
      includeDeliveryFee: true,
      deliveryFees: {},
    });
    expect(metrics.grossPriceUsd).toBeCloseTo(9.99, 2);
  });

  it('shows the fee can outweigh the carryout/delivery sticker gap entirely', () => {
    const carryout = computeDealMetrics(
      deal({ priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] }),
    );
    const deliverySticker = computeDealMetrics(
      deal({ fulfillment: 'delivery', priceUsd: 10.99, pizzaItems: [pizza({ shape: round(14) })] }),
    );
    const deliveryWithFee = computeDealMetrics(
      deal({ fulfillment: 'delivery', priceUsd: 10.99, pizzaItems: [pizza({ shape: round(14) })] }),
      { includeDeliveryFee: true, deliveryFees: { dominos: 4.99 } },
    );

    // A $1 sticker gap becomes a $6 gap once the fee is counted.
    expect(deliverySticker.costPerSqIn - carryout.costPerSqIn).toBeCloseTo(0.0065, 3);
    expect(deliveryWithFee.costPerSqIn - carryout.costPerSqIn).toBeCloseTo(0.0389, 3);
  });
});

describe('cost per topping slot', () => {
  it('divides by total slots across quantity', () => {
    const metrics = computeDealMetrics(
      deal({
        priceUsd: 12.0,
        pizzaItems: [pizza({ shape: round(12), quantity: 2, toppingCount: 3 })],
      }),
    );
    expect(metrics.costPerToppingSlot).toBeCloseTo(2.0, 2);
  });

  it('returns null for an unlimited-topping offer instead of dividing by a guess', () => {
    const metrics = computeDealMetrics(
      deal({
        priceUsd: 13.99,
        pizzaItems: [pizza({ toppingCount: null, toppingPolicy: 'unlimited' })],
      }),
    );
    expect(metrics.costPerToppingSlot).toBeNull();
    // The primary metric is unaffected — this deal still ranks on area.
    expect(metrics.rankable).toBe(true);
    expect(metrics.costPerSqIn).toBeGreaterThan(0);
  });

  it('flags that an "up to N toppings" offer assumes the maximum', () => {
    const metrics = computeDealMetrics(
      deal({ priceUsd: 9.99, pizzaItems: [pizza({ toppingCount: 3, toppingPolicy: 'up_to' })] }),
    );
    expect(metrics.costPerToppingSlot).toBeCloseTo(3.33, 2);
    expect(metrics.assumptions.some((a) => a.code === 'TOPPING_COUNT_IS_MAXIMUM')).toBe(true);
  });

  it('returns null when a zero-topping cheese pizza would divide by zero', () => {
    const metrics = computeDealMetrics(
      deal({ priceUsd: 7.99, pizzaItems: [pizza({ toppingCount: 0 })] }),
    );
    expect(metrics.costPerToppingSlot).toBeNull();
  });
});

describe('refusals', () => {
  it('will not rank a deal spanning two crust classes', () => {
    const metrics = computeDealMetrics(
      deal({
        kind: 'multi_pizza',
        priceUsd: 24.99,
        pizzaItems: [
          pizza({ crust: crust('Hand Tossed', 'standard') }),
          pizza({ crust: crust('Stuffed Crust', 'specialty') }),
        ],
      }),
    );
    expect(metrics.rankable).toBe(false);
    expect(metrics.warnings.map((w) => w.code)).toContain('MIXED_CRUST_CLASS');
  });

  it('will not rank an offer containing no pizza', () => {
    const metrics = computeDealMetrics(
      deal({ kind: 'bundle', priceUsd: 9.99, pizzaItems: [], otherItems: [side('Wings', 9.99)] }),
    );
    expect(metrics.rankable).toBe(false);
    expect(metrics.warnings.map((w) => w.code)).toContain('NO_PIZZA_ITEMS');
  });
});

describe('staleness', () => {
  it('carries a stale assumption through to the metrics', () => {
    const metrics = computeDealMetrics(
      deal({ stale: true, lastVerifiedAt: new Date('2026-07-01T00:00:00Z') }),
    );
    const assumption = metrics.assumptions.find((a) => a.code === 'STALE_DATA');
    expect(assumption?.message).toContain('2026-07-01');
    // Stale data is still shown and still ranked — it is flagged, not deleted.
    expect(metrics.rankable).toBe(true);
  });
});
