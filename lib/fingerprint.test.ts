import { describe, expect, it } from 'vitest';
import { deal, pizza, round, side } from './normalize/__fixtures__';
import { dealFingerprint } from './fingerprint';

describe('dealFingerprint', () => {
  it('is stable across a price change, so first_seen survives', () => {
    const cheap = deal({ priceUsd: 9.99 });
    const dearer = deal({ ...cheap, priceUsd: 10.99 });
    expect(dealFingerprint(dearer)).toBe(dealFingerprint(cheap));
  });

  it('ignores cosmetic renames', () => {
    const a = deal({ dealName: 'Large 3-Topping Carryout' });
    const b = deal({ ...a, dealName: '  large 3 topping carryout!  ' });
    expect(dealFingerprint(b)).toBe(dealFingerprint(a));
  });

  it('changes when the pizza gets smaller, so a downsize cannot hide behind the name', () => {
    const before = deal({ pizzaItems: [pizza({ shape: round(14) })] });
    const after = deal({ ...before, pizzaItems: [pizza({ shape: round(13.5) })] });
    expect(dealFingerprint(after)).not.toBe(dealFingerprint(before));
  });

  it('changes when the crust changes', () => {
    const handTossed = deal({ pizzaItems: [pizza()] });
    const stuffed = deal({
      ...handTossed,
      pizzaItems: [pizza({ crust: { name: 'Stuffed Crust', class: 'specialty' } })],
    });
    expect(dealFingerprint(stuffed)).not.toBe(dealFingerprint(handTossed));
  });

  it('separates carryout from delivery', () => {
    const carryout = deal({ fulfillment: 'carryout' });
    const delivery = deal({ ...carryout, fulfillment: 'delivery' });
    expect(dealFingerprint(delivery)).not.toBe(dealFingerprint(carryout));
  });

  it('changes when a bundle gains or loses a component', () => {
    const withSides = deal({
      kind: 'bundle',
      otherItems: [side('Breadsticks', 6.99), side('2-liter soda', 3.49)],
    });
    const dropped = deal({ ...withSides, otherItems: [side('Breadsticks', 6.99)] });
    expect(dealFingerprint(dropped)).not.toBe(dealFingerprint(withSides));
  });

  it('does not depend on item ordering', () => {
    const a = deal({
      kind: 'multi_pizza',
      pizzaItems: [pizza({ shape: round(14) }), pizza({ shape: round(12) })],
    });
    const b = deal({ ...a, pizzaItems: [...a.pizzaItems].reverse() });
    expect(dealFingerprint(b)).toBe(dealFingerprint(a));
  });

  it('separates two chains running the same offer', () => {
    const dominos = deal({ chain: 'dominos' });
    const pizzaHut = deal({ ...dominos, chain: 'pizza_hut' });
    expect(dealFingerprint(pizzaHut)).not.toBe(dealFingerprint(dominos));
  });
});
