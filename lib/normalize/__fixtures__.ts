import type { CrustClass, Deal, OtherItem, PizzaItem, Shape } from './types';

let nextId = 1;

export function round(diameterIn: number): Shape {
  return { kind: 'round', diameterIn };
}

export function rect(lengthIn: number, widthIn: number): Shape {
  return { kind: 'rect', lengthIn, widthIn };
}

export function pizza(overrides: Partial<PizzaItem> = {}): PizzaItem {
  return {
    quantity: 1,
    shape: round(14),
    sizeLabel: 'Large',
    crust: { name: 'Hand Tossed', class: 'standard' },
    toppingCount: 3,
    toppingPolicy: 'exact',
    premiumToppings: false,
    menuPriceUsd: null,
    ...overrides,
  };
}

export function side(descriptor: string, menuPriceUsd: number | null, quantity = 1): OtherItem {
  return { quantity, category: 'side', descriptor, menuPriceUsd };
}

export function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: nextId++,
    chain: 'dominos',
    dealName: 'Test deal',
    kind: 'single_pizza',
    fulfillment: 'carryout',
    priceUsd: 9.99,
    discountPercent: null,
    discountScope: null,
    pricingLocale: 'san-diego-ca',
    pizzaItems: [pizza()],
    otherItems: [],
    promoCode: null,
    sourceUrl: 'https://example.test/deals',
    stale: false,
    lastVerifiedAt: new Date('2026-07-30T00:00:00Z'),
    ...overrides,
  };
}

export function crust(name: string, cls: CrustClass) {
  return { name, class: cls };
}
