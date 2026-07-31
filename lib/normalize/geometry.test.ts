import { describe, expect, it } from 'vitest';
import { pizza, rect, round } from './__fixtures__';
import { areaProfile, areaSqIn, totalPizzaAreaSqIn } from './geometry';

describe('areaSqIn', () => {
  it('computes round pizza area from diameter', () => {
    expect(areaSqIn(round(14))).toBeCloseTo(153.938, 3);
    expect(areaSqIn(round(12))).toBeCloseTo(113.097, 3);
    expect(areaSqIn(round(10))).toBeCloseTo(78.54, 3);
  });

  it('handles a fractional diameter, since chains do not stick to whole inches', () => {
    // Papa John's large sits near 13.5", not the 14" its label implies.
    expect(areaSqIn(round(13.5))).toBeCloseTo(143.139, 3);
  });

  it('is the reason labels cannot be compared: a 0.5" difference is ~7.8% of the pizza', () => {
    const fourteen = areaSqIn(round(14));
    const thirteenFive = areaSqIn(round(13.5));
    expect((fourteen - thirteenFive) / thirteenFive).toBeCloseTo(0.0754, 3);
  });

  it('confirms the claim the whole app rests on: 14" has ~96% more area than 10"', () => {
    const ratio = areaSqIn(round(14)) / areaSqIn(round(10));
    expect(ratio).toBeCloseTo(1.96, 2);
    // Not the 40% a diameter-based intuition suggests.
    expect(ratio).not.toBeCloseTo(1.4, 1);
  });

  it('computes rectangular area, because Detroit-style is not round', () => {
    expect(areaSqIn(rect(10, 8))).toBe(80);
  });

  it('rejects non-positive dimensions rather than returning a nonsense area', () => {
    expect(() => areaSqIn(round(0))).toThrow(RangeError);
    expect(() => areaSqIn(round(-14))).toThrow(RangeError);
    expect(() => areaSqIn(rect(10, 0))).toThrow(RangeError);
  });
});

describe('totalPizzaAreaSqIn', () => {
  it('respects quantity', () => {
    const items = [pizza({ shape: round(12), quantity: 2 })];
    expect(totalPizzaAreaSqIn(items)).toBeCloseTo(226.195, 3);
  });

  it('sums across differently sized items', () => {
    const items = [pizza({ shape: round(14) }), pizza({ shape: round(12) })];
    expect(totalPizzaAreaSqIn(items)).toBeCloseTo(153.938 + 113.097, 2);
  });

  it('shows two 12" pizzas beat one 14" on total area', () => {
    const twoMediums = totalPizzaAreaSqIn([pizza({ shape: round(12), quantity: 2 })]);
    const oneLarge = totalPizzaAreaSqIn([pizza({ shape: round(14) })]);
    expect(twoMediums).toBeGreaterThan(oneLarge);
    expect(twoMediums / oneLarge).toBeCloseTo(1.469, 2);
  });

  it('rejects a non-integer or zero quantity', () => {
    expect(() => totalPizzaAreaSqIn([pizza({ quantity: 0 })])).toThrow(RangeError);
    expect(() => totalPizzaAreaSqIn([pizza({ quantity: 1.5 })])).toThrow(RangeError);
  });
});

describe('areaProfile', () => {
  it('distinguishes two mediums from one large', () => {
    const twoMediums = areaProfile([pizza({ shape: round(12), quantity: 2 })]);
    const oneLarge = areaProfile([pizza({ shape: round(14) })]);
    expect(twoMediums).not.toBe(oneLarge);
  });

  it('is stable regardless of item ordering', () => {
    const a = areaProfile([pizza({ shape: round(14) }), pizza({ shape: round(12) })]);
    const b = areaProfile([pizza({ shape: round(12) }), pizza({ shape: round(14) })]);
    expect(a).toBe(b);
  });

  it('collapses identical sizes into a count', () => {
    const separateItems = areaProfile([pizza({ shape: round(12) }), pizza({ shape: round(12) })]);
    const oneItemQtyTwo = areaProfile([pizza({ shape: round(12), quantity: 2 })]);
    expect(separateItems).toBe(oneItemQtyTwo);
    expect(separateItems).toContain('x2');
  });
});
