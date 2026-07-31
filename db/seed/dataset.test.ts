import { describe, expect, it } from 'vitest';
import { computeDealMetrics, rankDeals } from '@/lib/normalize';
import { seedDataset } from './dataset';
import { seedDeliveryFees, seedToDeals } from './toDeals';

const deals = seedToDeals(seedDataset);
const byName = (name: string) => {
  const found = deals.find((d) => d.dealName.includes(name));
  if (!found) throw new Error(`No seed deal matching "${name}"`);
  return found;
};

describe('seed dataset integrity', () => {
  it('resolves every deal without inventing a size or crust', () => {
    expect(deals.length).toBe(seedDataset.deals.length);
    expect(deals.every((d) => d.pizzaItems.length > 0)).toBe(true);
  });

  it('covers all three chains', () => {
    expect(new Set(deals.map((d) => d.chain))).toEqual(
      new Set(['dominos', 'pizza_hut', 'papa_johns']),
    );
  });

  it('carries a source URL on every row that asserts a fact', () => {
    const sourced = [
      ...seedDataset.deals,
      ...seedDataset.crusts,
      ...seedDataset.sizes,
      ...seedDataset.menuPizzaPrices,
      ...seedDataset.componentValues,
    ];
    expect(sourced.every((row) => row.sourceUrl.startsWith('https://'))).toBe(true);
  });

  it('is honest that nothing came from a primary source', () => {
    const sourced = [
      ...seedDataset.deals,
      ...seedDataset.crusts,
      ...seedDataset.sizes,
      ...seedDataset.menuPizzaPrices,
      ...seedDataset.componentValues,
    ];
    // If this ever fails it is because someone verified a row against the chain's own
    // page — good, but the UI's "unverified" banner logic needs revisiting with it.
    expect(sourced.every((row) => row.provenance === 'manual_secondary')).toBe(true);
  });

  it('records the Papa John\'s diameter conflict instead of silently picking a side', () => {
    const papaLarge = seedDataset.sizes.find(
      (s) => s.chain === 'papa_johns' && s.sizeLabel === 'Large',
    );
    expect(papaLarge?.note).toContain('DISPUTED');
    expect(papaLarge?.note).toContain('14"');
    expect(papaLarge?.note).toContain('13.5"');
  });

  it('ships no invented delivery fee, so the D1 toggle cannot show a fabricated number', () => {
    expect(seedDeliveryFees(seedDataset)).toEqual({});
  });

  it('fails loudly when a deal references a size that was never observed', () => {
    const broken = {
      ...seedDataset,
      deals: [
        {
          ...seedDataset.deals[0]!,
          pizzaItems: [{ sizeLabel: 'Colossal', crustName: 'Hand Tossed', toppingCount: 1 }],
        },
      ],
    };
    expect(() => seedToDeals(broken)).toThrow(/No size observation/);
  });
});

describe('seed deals through the normalization module', () => {
  it('produces a usable metric for the plain carryout deal', () => {
    const metrics = computeDealMetrics(byName('Large 3-Topping Carryout'));
    expect(metrics.totalAreaSqIn).toBeCloseTo(153.938, 2);
    expect(metrics.costPerSqIn).toBeCloseTo(0.0519, 4);
    expect(metrics.rankable).toBe(true);
  });

  it('prices the Papa John\'s percentage offer from the menu (D6)', () => {
    const metrics = computeDealMetrics(byName('30% off Large 1-Topping Epic Stuffed Crust'));
    // 30% off the $15.19 menu price.
    expect(metrics.grossPriceUsd).toBeCloseTo(10.63, 2);
    expect(metrics.pricingBasis).toBe('derived_from_discount');
    expect(metrics.rankable).toBe(true);
    expect(metrics.segment.crustClass).toBe('specialty');
  });

  it('refuses the Domino\'s percentage offer that has no menu price behind it', () => {
    const metrics = computeDealMetrics(byName('50% off menu-priced pizzas'));
    expect(metrics.rankable).toBe(false);
    expect(metrics.warnings.map((w) => w.code)).toContain('MISSING_MENU_PRICE');
  });

  it('imputes the Big Dinner Box partially and says which component it could not price', () => {
    const metrics = computeDealMetrics(byName('Big Dinner Box'));
    expect(metrics.basis).toBe('imputed_pizza_only');
    // $21.99 less the $10.99 wings; breadsticks have no sourced price.
    expect(metrics.effectivePriceUsd).toBeCloseTo(11.0, 2);

    const assumption = metrics.assumptions.find((a) => a.code === 'BUNDLE_CREDIT_PARTIAL');
    expect(assumption?.message).toContain('Not credited');
    expect(assumption?.message).toContain('Breadstick');
  });

  it('declines to impute the Papa John\'s bundle rather than treating sides as free', () => {
    const metrics = computeDealMetrics(byName('Large 2-Topping + 6pc Wings'));
    expect(metrics.basis).toBe('as_advertised');
    expect(metrics.effectivePriceUsd).toBeCloseTo(22.0, 2);
    expect(metrics.assumptions.map((a) => a.code)).toContain('BUNDLE_NOT_IMPUTED');
  });

  it('flags that the "up to 7 toppings" deal assumes the maximum', () => {
    const metrics = computeDealMetrics(byName('Any Crust, Any Toppings'));
    expect(metrics.assumptions.map((a) => a.code)).toContain('TOPPING_COUNT_IS_MAXIMUM');
  });

  it('shows how much the disputed Papa John\'s diameter moves the metric', () => {
    const papa = computeDealMetrics(byName('30% off Large 1-Topping Epic Stuffed Crust'));
    // The dataset uses 13.5"; the competing source says 14".
    expect(papa.totalAreaSqIn).toBeCloseTo(143.139, 2);

    const atFourteen = papa.effectivePriceUsd / (Math.PI * 7 * 7);
    const overstatement = (papa.costPerSqIn - atFourteen) / atFourteen;

    // Believing the wrong source makes this deal look 7.5% worse than it may be —
    // wider than the gap between adjacent deals in most segments, which is why the
    // scraper has to read diameter from the chain itself.
    expect(overstatement).toBeCloseTo(0.0754, 3);
  });
});

describe('seed data ranked end to end', () => {
  const result = rankDeals(deals, { deliveryFees: seedDeliveryFees(seedDataset) });

  it('separates tracks, crust classes, and fulfillment into distinct segments', () => {
    expect(result.segments.length).toBeGreaterThan(1);
    for (const segment of result.segments) {
      const classes = new Set(segment.deals.map((d) => d.metrics.segment.crustClass));
      const fulfillments = new Set(segment.deals.map((d) => d.deal.fulfillment));
      const tracks = new Set(segment.deals.map((d) => d.metrics.segment.track));
      expect(classes.size).toBe(1);
      expect(fulfillments.size).toBe(1);
      expect(tracks.size).toBe(1);
    }
  });

  it('never puts a bundle in a pizza-only segment', () => {
    for (const segment of result.segments) {
      const kinds = new Set(segment.deals.map((d) => d.deal.kind));
      if (segment.segment.track === 'pizza') {
        expect(kinds.has('bundle')).toBe(false);
      }
    }
  });

  it('ranks each segment cheapest-per-square-inch first', () => {
    for (const segment of result.segments) {
      const costs = segment.deals.map((d) => d.metrics.costPerSqIn);
      expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    }
  });

  it('surfaces the unrankable deal instead of dropping it', () => {
    expect(result.ungrouped.length).toBeGreaterThan(0);
    expect(result.ungrouped.every((u) => u.metrics.warnings.length > 0)).toBe(true);
    expect(result.ungrouped.map((u) => u.deal.dealName)).toContain(
      '50% off menu-priced pizzas',
    );
  });

  it('accounts for every seeded deal exactly once', () => {
    const ranked = result.segments.flatMap((s) => s.deals.map((d) => d.deal.id));
    const ungrouped = result.ungrouped.map((u) => u.deal.id);
    expect(new Set([...ranked, ...ungrouped]).size).toBe(deals.length);
  });
});
