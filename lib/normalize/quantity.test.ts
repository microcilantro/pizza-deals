import { describe, expect, it } from 'vitest';
import { deal, pizza, round, side } from './__fixtures__';
import { computeDealMetrics } from './metrics';
import { rankDeals } from './rank';
import {
  DEFAULT_SERVING_MODEL,
  REFERENCE_DIAMETER_IN,
  SERVING_PRESETS,
  areaPerPersonSqIn,
  areaPerSliceSqIn,
  peopleFed,
  rankForPeople,
  rankForTarget,
  solveForTarget,
  targetAreaForPeople,
  targetAreaForPizzas,
} from './quantity';

describe('targetAreaForPizzas', () => {
  it('converts a slider position into area using the stated reference size', () => {
    expect(targetAreaForPizzas(1)).toBeCloseTo(153.938, 2);
    expect(targetAreaForPizzas(3)).toBeCloseTo(461.814, 2);
  });

  it('accepts a different reference so the label can be changed without touching the math', () => {
    expect(targetAreaForPizzas(2, 12)).toBeCloseTo(226.195, 2);
  });

  it('rejects a non-positive count', () => {
    expect(() => targetAreaForPizzas(0)).toThrow(RangeError);
  });

  it('uses a 14 inch reference by default', () => {
    expect(REFERENCE_DIAMETER_IN).toBe(14);
  });
});

describe('solveForTarget', () => {
  const largeCarryout = computeDealMetrics(
    deal({ priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] }),
  );

  it('buys one offer when it already covers the target', () => {
    const plan = solveForTarget(largeCarryout, 100);
    expect(plan.units).toBe(1);
    expect(plan.totalCostUsd).toBeCloseTo(9.99, 2);
    expect(plan.overshootSqIn).toBeCloseTo(53.94, 1);
  });

  it('rounds up to whole offers, since you cannot buy two thirds of a pizza', () => {
    const plan = solveForTarget(largeCarryout, targetAreaForPizzas(3));
    expect(plan.units).toBe(3);
    expect(plan.totalCostUsd).toBeCloseTo(29.97, 2);
    expect(plan.overshootSqIn).toBeCloseTo(0, 5);
  });

  it('charges for the overshoot in the effective metric', () => {
    // Target 1.5 large pizzas; you must buy 2.
    const plan = solveForTarget(largeCarryout, targetAreaForPizzas(1.5));
    expect(plan.units).toBe(2);
    expect(plan.totalCostUsd).toBeCloseTo(19.98, 2);
    expect(plan.overshootPct).toBeCloseTo(0.3333, 3);
    // Cost per in² is unchanged at 0.0649; cost per *wanted* in² is a third worse.
    expect(plan.effectiveCostPerWantedSqIn).toBeCloseTo(0.0865, 4);
    expect(plan.effectiveCostPerWantedSqIn).toBeGreaterThan(largeCarryout.costPerSqIn);
  });

  it('flags both the repeat purchase and the overshoot', () => {
    const plan = solveForTarget(largeCarryout, targetAreaForPizzas(1.5));
    const codes = plan.assumptions.map((a) => a.code);
    expect(codes).toContain('REPEAT_PURCHASE');
    expect(codes).toContain('TARGET_OVERSHOT');
  });

  it('does not claim a repeat purchase when one offer suffices', () => {
    const plan = solveForTarget(largeCarryout, 50);
    expect(plan.assumptions.map((a) => a.code)).not.toContain('REPEAT_PURCHASE');
  });

  it('rejects a non-positive target', () => {
    expect(() => solveForTarget(largeCarryout, 0)).toThrow(RangeError);
  });
});

describe('why the slider exists: quantity reorders the ranking', () => {
  // One 12" at $7.40 — the better ratio ($0.0654/in²), but small, so hitting a big
  // target takes several and overshoots.
  const smallGoodRatio = deal({
    chain: 'dominos',
    priceUsd: 7.4,
    pizzaItems: [pizza({ shape: round(12), sizeLabel: 'Medium' })],
  });
  // Two 14" at $21.00 — the worse ratio ($0.0682/in²), but sized to land near the
  // target in a single purchase.
  const largeWorseRatio = deal({
    chain: 'pizza_hut',
    kind: 'multi_pizza',
    priceUsd: 21.0,
    pizzaItems: [pizza({ shape: round(14), quantity: 2 })],
  });

  it('ranks the better ratio first when quantity is ignored', () => {
    const { segments } = rankDeals([smallGoodRatio, largeWorseRatio]);
    const ranked = segments[0]!.deals;
    expect(ranked[0]!.deal.chain).toBe('dominos');
    expect(ranked[0]!.metrics.costPerSqIn).toBeLessThan(ranked[1]!.metrics.costPerSqIn);
  });

  it('is scale-invariant, so a plain multiplier would never change that order', () => {
    const a = computeDealMetrics(smallGoodRatio);
    const b = computeDealMetrics(largeWorseRatio);
    // Ten of each: the ratio between them is identical.
    expect((a.costPerSqIn * 10) / (b.costPerSqIn * 10)).toBeCloseTo(a.costPerSqIn / b.costPerSqIn, 10);
  });

  it('keeps the better ratio on top when the target divides cleanly', () => {
    // Exactly two mediums' worth: no overshoot, so the ratio decides.
    const { segments } = rankForTarget([smallGoodRatio, largeWorseRatio], 226.194);
    const ranked = segments[0]!.deals;

    expect(ranked[0]!.deal.chain).toBe('dominos');
    expect(ranked[0]!.plan.units).toBe(2);
    expect(ranked[0]!.plan.totalCostUsd).toBeCloseTo(14.8, 2);
    expect(ranked[1]!.plan.totalCostUsd).toBeCloseTo(21.0, 2);
  });

  it('flips the order once whole-offer overshoot outweighs the ratio', () => {
    // 300 in² sits just past two mediums, so the better-ratio deal must buy a third.
    const { segments } = rankForTarget([smallGoodRatio, largeWorseRatio], 300);
    const ranked = segments[0]!.deals;

    const dominos = ranked.find((r) => r.deal.chain === 'dominos')!;
    const pizzaHut = ranked.find((r) => r.deal.chain === 'pizza_hut')!;

    // Three mediums: 339.3 in² for $22.20, overshooting by 39 in².
    expect(dominos.plan.units).toBe(3);
    expect(dominos.plan.totalCostUsd).toBeCloseTo(22.2, 2);
    expect(dominos.plan.overshootSqIn).toBeCloseTo(39.29, 1);
    // One two-large offer: 307.9 in² for $21.00, overshooting by 8.
    expect(pizzaHut.plan.units).toBe(1);
    expect(pizzaHut.plan.totalCostUsd).toBeCloseTo(21.0, 2);
    expect(pizzaHut.plan.overshootSqIn).toBeCloseTo(7.88, 1);

    // The worse ratio now wins on what you actually spend — which the headline
    // cost-per-in² ranking, on its own, would never tell you.
    expect(pizzaHut.metrics.costPerSqIn).toBeGreaterThan(dominos.metrics.costPerSqIn);
    expect(ranked[0]!.deal.chain).toBe('pizza_hut');
  });
});

describe('rankForTarget', () => {
  it('keeps the segmentation rules intact', () => {
    const standard = deal({ pizzaItems: [pizza()] });
    const specialty = deal({
      pizzaItems: [pizza({ crust: { name: 'Stuffed Crust', class: 'specialty' } })],
    });
    const bundled = deal({
      kind: 'bundle',
      priceUsd: 19.99,
      otherItems: [side('Breadsticks', 6.99)],
    });

    const { segments } = rankForTarget([standard, specialty, bundled], targetAreaForPizzas(2));
    expect(segments).toHaveLength(3);
    expect(segments.every((s) => s.deals.length === 1)).toBe(true);
  });

  it('breaks a spend tie in favour of less waste', () => {
    const exact = deal({
      chain: 'pizza_hut',
      kind: 'multi_pizza',
      priceUsd: 20.0,
      pizzaItems: [pizza({ shape: round(14), quantity: 2 })],
    });
    const wasteful = deal({
      chain: 'dominos',
      kind: 'multi_pizza',
      priceUsd: 20.0,
      pizzaItems: [pizza({ shape: round(16), quantity: 2 })],
    });

    const { segments } = rankForTarget([wasteful, exact], targetAreaForPizzas(2));
    expect(segments[0]!.deals[0]!.deal.chain).toBe('pizza_hut');
  });

  it('still refuses to rank what it could not rank before', () => {
    const noMenuPrice = deal({
      priceUsd: null,
      discountPercent: 50,
      discountScope: 'pizza',
      pizzaItems: [pizza({ menuPriceUsd: null })],
    });
    const { segments, ungrouped } = rankForTarget([noMenuPrice, deal()], targetAreaForPizzas(1));
    expect(ungrouped).toHaveLength(1);
    expect(segments.flatMap((s) => s.deals)).toHaveLength(1);
  });

  it('reports the target it solved for', () => {
    const result = rankForTarget([deal()], 300);
    expect(result.targetAreaSqIn).toBe(300);
  });
});

describe('serving model (the slider label)', () => {
  it('derives area per person from slices rather than a bare constant', () => {
    // A 14" pizza cut into 8 gives ~19.24 in² per slice; three slices is ~57.7 in².
    expect(areaPerSliceSqIn()).toBeCloseTo(19.242, 2);
    expect(areaPerPersonSqIn()).toBeCloseTo(57.727, 2);
  });

  it('scales the target with headcount', () => {
    const four = targetAreaForPeople(4);
    expect(four.targetAreaSqIn).toBeCloseTo(230.907, 2);
    expect(four.targetAreaSqIn).toBeCloseTo(areaPerPersonSqIn() * 4, 6);
  });

  it('responds to appetite presets', () => {
    const light = targetAreaForPeople(4, SERVING_PRESETS.light);
    const normal = targetAreaForPeople(4, SERVING_PRESETS.normal);
    const hearty = targetAreaForPeople(4, SERVING_PRESETS.hearty);

    expect(light.targetAreaSqIn).toBeLessThan(normal.targetAreaSqIn);
    expect(hearty.targetAreaSqIn).toBeGreaterThan(normal.targetAreaSqIn);
    expect(hearty.targetAreaSqIn / light.targetAreaSqIn).toBeCloseTo(2, 6);
  });

  it('states the assumption in terms a user can check and change', () => {
    const { assumption } = targetAreaForPeople(4);
    expect(assumption.code).toBe('SERVING_SIZE_ASSUMED');
    expect(assumption.message).toContain('3 slices per person');
    expect(assumption.message).toContain('14" pizza cut into 8');
    expect(assumption.message).toContain('rule of thumb');
  });

  it('rejects nonsense inputs rather than producing a silent target', () => {
    expect(() => targetAreaForPeople(0)).toThrow(RangeError);
    expect(() => targetAreaForPeople(-2)).toThrow(RangeError);
    expect(() => targetAreaForPeople(4, { ...DEFAULT_SERVING_MODEL, slicesPerPerson: 0 })).toThrow(
      RangeError,
    );
  });

  it('reports how many people an offer feeds', () => {
    expect(peopleFed(targetAreaForPizzas(1))).toBeCloseTo(2.667, 2);
    expect(peopleFed(targetAreaForPizzas(3))).toBeCloseTo(8, 5);
  });
});

describe('rankForPeople', () => {
  const largeCarryout = deal({
    chain: 'dominos',
    priceUsd: 9.99,
    pizzaItems: [pizza({ shape: round(14) })],
  });
  const twoMediums = deal({
    chain: 'pizza_hut',
    kind: 'multi_pizza',
    priceUsd: 13.98,
    pizzaItems: [pizza({ shape: round(12), quantity: 2 })],
  });

  it('solves the same target the people conversion produces', () => {
    const result = rankForPeople([largeCarryout], 6);
    expect(result.people).toBe(6);
    expect(result.targetAreaSqIn).toBeCloseTo(targetAreaForPeople(6).targetAreaSqIn, 6);
  });

  it('works out how many of each offer feeds the group', () => {
    const result = rankForPeople([largeCarryout, twoMediums], 6);
    const ranked = result.segments.flatMap((s) => s.deals);

    // 6 people is ~346 in². One 14" is 154, so three of them; two 12" is 226, so two sets.
    expect(ranked.find((r) => r.deal.chain === 'dominos')!.plan.units).toBe(3);
    expect(ranked.find((r) => r.deal.chain === 'pizza_hut')!.plan.units).toBe(2);
  });

  it('attaches the serving assumption to every plan, not just the page', () => {
    const result = rankForPeople([largeCarryout, twoMediums], 6);
    for (const segment of result.segments) {
      for (const entry of segment.deals) {
        expect(entry.plan.assumptions[0]!.code).toBe('SERVING_SIZE_ASSUMED');
      }
    }
  });

  it('changes the answer when appetite changes', () => {
    const light = rankForPeople([largeCarryout], 6, { servingModel: SERVING_PRESETS.light });
    const hearty = rankForPeople([largeCarryout], 6, { servingModel: SERVING_PRESETS.hearty });

    // 6 people at 2 slices is 12 slices — one and a half 14" pizzas, so buy 2.
    expect(light.segments[0]!.deals[0]!.plan.units).toBe(2);
    // At 4 slices it is 24 slices, exactly three pizzas.
    expect(hearty.segments[0]!.deals[0]!.plan.units).toBe(3);
    expect(hearty.segments[0]!.deals[0]!.plan.overshootSqIn).toBeCloseTo(0, 5);
    expect(light.segments[0]!.deals[0]!.plan.totalCostUsd).toBeLessThan(
      hearty.segments[0]!.deals[0]!.plan.totalCostUsd,
    );
  });

  it('keeps segmentation intact — feeding a crowd is no reason to compare crust classes', () => {
    const specialty = deal({
      chain: 'papa_johns',
      priceUsd: 15.0,
      pizzaItems: [pizza({ crust: { name: 'Stuffed Crust', class: 'specialty' } })],
    });
    const result = rankForPeople([largeCarryout, specialty], 6);
    expect(result.segments).toHaveLength(2);
  });
});
