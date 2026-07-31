import { describe, expect, it } from 'vitest';
import { deal, pizza, round, side } from './__fixtures__';
import { imputePizzaOnlyPrice } from './bundles';
import { computeDealMetrics } from './metrics';
import { DEFAULT_OPTIONS } from './types';

const bundle = deal({
  kind: 'bundle',
  dealName: 'Two mediums + breadsticks + 2-liter',
  priceUsd: 19.99,
  pizzaItems: [pizza({ shape: round(12), sizeLabel: 'Medium', quantity: 2 })],
  otherItems: [side('Breadsticks', 6.99), side('2-liter soda', 3.49)],
});

describe('imputePizzaOnlyPrice', () => {
  it('credits components at full menu price by default (D4)', () => {
    const result = imputePizzaOnlyPrice(bundle, 19.99, DEFAULT_OPTIONS);
    expect(result.creditedUsd).toBeCloseTo(10.48, 2);
    expect(result.pizzaOnlyPriceUsd).toBeCloseTo(9.51, 2);
    expect(result.confidence).toBe('exact');
    expect(result.applied).toBe(true);
  });

  it('honors a haircut factor when configured', () => {
    const result = imputePizzaOnlyPrice(bundle, 19.99, {
      ...DEFAULT_OPTIONS,
      componentCreditFactor: 0.7,
    });
    expect(result.creditedUsd).toBeCloseTo(7.34, 2);
    expect(result.pizzaOnlyPriceUsd).toBeCloseTo(12.65, 2);
  });

  it('names every credited component and the price used, so the UI can show its work', () => {
    const result = imputePizzaOnlyPrice(bundle, 19.99, DEFAULT_OPTIONS);
    const message = result.assumptions[0]?.message ?? '';
    expect(message).toContain('Breadsticks');
    expect(message).toContain('$6.99');
    expect(message).toContain('2-liter soda');
    expect(message).toContain('$3.49');
  });

  it('never counts an unpriceable component as free', () => {
    const partial = deal({
      ...bundle,
      otherItems: [side('Breadsticks', 6.99), side('Mystery dessert', null)],
    });
    const result = imputePizzaOnlyPrice(partial, 19.99, DEFAULT_OPTIONS);

    expect(result.confidence).toBe('partial');
    expect(result.creditedUsd).toBeCloseTo(6.99, 2);
    expect(result.uncreditedItems.map((i) => i.descriptor)).toEqual(['Mystery dessert']);
    expect(result.assumptions[0]?.message).toContain('Not credited');
  });

  it('falls back to the advertised price when nothing can be priced', () => {
    const unpriceable = deal({
      ...bundle,
      otherItems: [side('Breadsticks', null), side('2-liter soda', null)],
    });
    const result = imputePizzaOnlyPrice(unpriceable, 19.99, DEFAULT_OPTIONS);

    expect(result.applied).toBe(false);
    expect(result.confidence).toBe('none');
    expect(result.pizzaOnlyPriceUsd).toBe(19.99);
    expect(result.assumptions[0]?.code).toBe('BUNDLE_NOT_IMPUTED');
  });

  it('clamps and flags a credit that would drive the pizza price to zero', () => {
    const overCredited = deal({
      ...bundle,
      priceUsd: 10.0,
      otherItems: [side('Wings, 8pc', 9.99), side('2-liter soda', 3.49)],
    });
    const result = imputePizzaOnlyPrice(overCredited, 10.0, DEFAULT_OPTIONS);

    expect(result.pizzaOnlyPriceUsd).toBeGreaterThan(0);
    expect(result.warnings.map((w) => w.code)).toContain('IMPUTED_PRICE_NONPOSITIVE');
  });

  it('multiplies credit by component quantity', () => {
    const twoSodas = deal({
      ...bundle,
      otherItems: [side('2-liter soda', 3.49, 2)],
    });
    const result = imputePizzaOnlyPrice(twoSodas, 19.99, DEFAULT_OPTIONS);
    expect(result.creditedUsd).toBeCloseTo(6.98, 2);
  });
});

describe('the imputation gap the UI has to surface', () => {
  it('flips the bundle from worse to better than a plain large', () => {
    const plainLarge = deal({ priceUsd: 9.99, pizzaItems: [pizza({ shape: round(14) })] });

    const largeMetrics = computeDealMetrics(plainLarge);
    const bundleMetrics = computeDealMetrics(bundle);

    // As advertised, the bundle is the worse buy per square inch.
    const asAdvertised = bundleMetrics.grossPriceUsd / bundleMetrics.totalAreaSqIn;
    expect(asAdvertised).toBeCloseTo(0.0884, 4);
    expect(asAdvertised).toBeGreaterThan(largeMetrics.costPerSqIn);

    // Credit the sides and it becomes the better one. Same offer, same day.
    expect(bundleMetrics.costPerSqIn).toBeCloseTo(0.042, 4);
    expect(bundleMetrics.costPerSqIn).toBeLessThan(largeMetrics.costPerSqIn);

    // Which is why the basis and the assumption must reach the UI.
    expect(bundleMetrics.basis).toBe('imputed_pizza_only');
    expect(bundleMetrics.assumptions.some((a) => a.code === 'BUNDLE_CREDIT')).toBe(true);
  });
});
