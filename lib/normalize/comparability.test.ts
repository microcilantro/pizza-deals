import { describe, expect, it } from 'vitest';
import { crust, deal, pizza, round, side } from './__fixtures__';
import { canCompare, comparabilityKey, crustClassOf, segmentOf, trackOf } from './comparability';

const handTossed = crust('Hand Tossed', 'standard');
const stuffed = crust('Stuffed Crust', 'specialty');
const thin = crust('Thin N Crispy', 'thin');

describe('crust segmentation (requirement 3)', () => {
  it('never compares a specialty crust against a standard one', () => {
    const standard = deal({ pizzaItems: [pizza({ crust: handTossed })] });
    const specialty = deal({ pizzaItems: [pizza({ crust: stuffed })] });
    expect(canCompare(standard, specialty)).toBe(false);
  });

  it('keeps thin crust in its own class (D2)', () => {
    const standard = deal({ pizzaItems: [pizza({ crust: handTossed })] });
    const thinCrust = deal({ pizzaItems: [pizza({ crust: thin })] });
    expect(canCompare(standard, thinCrust)).toBe(false);
    expect(crustClassOf(thinCrust)).toBe('thin');
  });

  it('compares two specialty-crust deals from different chains against each other', () => {
    const pizzaHut = deal({ chain: 'pizza_hut', pizzaItems: [pizza({ crust: stuffed })] });
    const papaJohns = deal({ chain: 'papa_johns', pizzaItems: [pizza({ crust: stuffed })] });
    expect(canCompare(pizzaHut, papaJohns)).toBe(true);
  });

  it('returns null for a deal spanning crust classes rather than picking one', () => {
    const mixed = deal({
      kind: 'multi_pizza',
      pizzaItems: [pizza({ crust: handTossed }), pizza({ crust: stuffed })],
    });
    expect(crustClassOf(mixed)).toBeNull();
    expect(segmentOf(mixed)).toBeNull();
    expect(comparabilityKey(mixed)).toBeNull();
  });
});

describe('the premium-crust edge case', () => {
  it('separates two "stuffed crust deals" at the same price that are not the same offer', () => {
    // Stuffed crust comes in different sizes at different chains. Same headline price,
    // same crust name, materially different amounts of pizza.
    const largeStuffed = deal({
      chain: 'pizza_hut',
      priceUsd: 14.99,
      pizzaItems: [pizza({ shape: round(14), sizeLabel: 'Large', crust: stuffed })],
    });
    const mediumStuffed = deal({
      chain: 'dominos',
      priceUsd: 14.99,
      pizzaItems: [pizza({ shape: round(12), sizeLabel: 'Medium', crust: stuffed })],
    });

    // Same crust class, so the headline list does rank them together...
    expect(canCompare(largeStuffed, mediumStuffed, 'area')).toBe(true);
    // ...but strict mode, which requires identical sizes, keeps them apart.
    expect(canCompare(largeStuffed, mediumStuffed, 'strict')).toBe(false);
  });
});

describe('fulfillment separation (requirement 5)', () => {
  it('never compares carryout against delivery', () => {
    const carryout = deal({ fulfillment: 'carryout' });
    const delivery = deal({ fulfillment: 'delivery' });
    expect(canCompare(carryout, delivery)).toBe(false);
  });
});

describe('bundle separation (requirement 4)', () => {
  it('puts bundles on their own track', () => {
    const pureP = deal({ kind: 'single_pizza' });
    const bundled = deal({ kind: 'bundle', otherItems: [side('Breadsticks', 6.99)] });
    expect(trackOf(pureP)).toBe('pizza');
    expect(trackOf(bundled)).toBe('bundle');
    expect(canCompare(pureP, bundled)).toBe(false);
  });

  it('keeps a multi-pizza deal on the pizza track, since it needs no imputation', () => {
    const twoPizzas = deal({
      kind: 'multi_pizza',
      pizzaItems: [pizza({ shape: round(12), quantity: 2 })],
    });
    expect(trackOf(twoPizzas)).toBe('pizza');
    expect(canCompare(twoPizzas, deal({ kind: 'single_pizza' }))).toBe(true);
  });
});

describe('comparability modes (D3)', () => {
  const oneLarge = deal({ pizzaItems: [pizza({ shape: round(14) })] });
  const twoMediums = deal({
    kind: 'multi_pizza',
    pizzaItems: [pizza({ shape: round(12), quantity: 2 })],
  });

  it('area mode ranks different size compositions together', () => {
    expect(canCompare(oneLarge, twoMediums, 'area')).toBe(true);
  });

  it('strict mode requires an identical size composition', () => {
    expect(canCompare(oneLarge, twoMediums, 'strict')).toBe(false);
  });

  it('strict mode still matches genuinely identical compositions', () => {
    const anotherLarge = deal({ chain: 'pizza_hut', pizzaItems: [pizza({ shape: round(14) })] });
    expect(canCompare(oneLarge, anotherLarge, 'strict')).toBe(true);
  });

  it('strict mode separates a 14" from a 13.5", which area mode groups', () => {
    const papaLarge = deal({
      chain: 'papa_johns',
      pizzaItems: [pizza({ shape: round(13.5), sizeLabel: 'Large' })],
    });
    expect(canCompare(oneLarge, papaLarge, 'area')).toBe(true);
    expect(canCompare(oneLarge, papaLarge, 'strict')).toBe(false);
  });
});
