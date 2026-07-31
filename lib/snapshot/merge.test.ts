import { describe, expect, it } from 'vitest';
import type { ScrapeResult, ScrapedDeal } from '@/scrapers/types';
import { mergeScrape } from './merge';
import type { Snapshot } from './types';

const CHAINS = [
  {
    slug: 'dominos',
    displayName: "Domino's",
    menuUrl: 'https://www.dominos.com/menu',
    dealsUrl: 'https://www.dominos.com/deals',
  },
  {
    slug: 'pizza_hut',
    displayName: 'Pizza Hut',
    menuUrl: 'https://www.pizzahut.com/menu',
    dealsUrl: 'https://www.pizzahut.com/deals',
  },
];

const DAY1 = new Date('2026-08-01T12:00:00Z');
const DAY2 = new Date('2026-08-02T12:00:00Z');
const DAY3 = new Date('2026-08-03T12:00:00Z');

function scrapedDeal(overrides: Partial<ScrapedDeal> = {}): ScrapedDeal {
  return {
    dealName: 'Large 3-Topping Carryout',
    kind: 'single_pizza',
    fulfillment: 'carryout',
    priceUsd: 7.99,
    discountPercent: null,
    discountScope: null,
    promoCode: null,
    validThrough: null,
    pizzaItems: [
      {
        quantity: 1,
        sizeLabel: 'Large',
        crustName: 'Hand Tossed',
        toppingCount: 3,
        toppingPolicy: 'exact',
      },
    ],
    otherItems: [],
    sourceUrl: 'https://www.dominos.com/deals',
    notes: [],
    ...overrides,
  };
}

function result(overrides: Partial<ScrapeResult> = {}): ScrapeResult {
  return {
    chain: 'dominos',
    status: 'ok',
    startedAt: DAY1,
    finishedAt: DAY1,
    sizes: [
      { sizeLabel: 'Large', shape: 'round', diameterIn: 14, sourceUrl: 'https://x/menu' },
      { sizeLabel: 'Medium', shape: 'round', diameterIn: 12, sourceUrl: 'https://x/menu' },
    ],
    crusts: [],
    menuPrices: [],
    deals: [scrapedDeal()],
    unparsed: [],
    errors: [],
    screenshotPaths: [],
    ...overrides,
  };
}

const merge = (previous: Snapshot | null, results: ScrapeResult[], now: Date) =>
  mergeScrape(previous, results, { now, pricingLocale: 'san-diego-ca', chains: CHAINS });

describe('first run', () => {
  it('creates deals with firstSeen set to now', () => {
    const snapshot = merge(null, [result()], DAY1);
    expect(snapshot.deals).toHaveLength(1);
    expect(snapshot.deals[0]).toMatchObject({
      firstSeen: DAY1.toISOString(),
      lastSeen: DAY1.toISOString(),
      active: true,
      stale: false,
    });
    expect(snapshot.deals[0]!.priceHistory).toHaveLength(1);
  });

  it('resolves diameter onto the deal from the scraped sizes', () => {
    const snapshot = merge(null, [result()], DAY1);
    expect(snapshot.deals[0]!.pizzaItems[0]).toMatchObject({ shape: 'round', diameterIn: 14 });
  });
});

describe('a deal seen again the next day', () => {
  it('keeps firstSeen and advances lastSeen', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [result()], DAY2);

    expect(day2.deals).toHaveLength(1);
    expect(day2.deals[0]).toMatchObject({
      firstSeen: DAY1.toISOString(),
      lastSeen: DAY2.toISOString(),
      active: true,
      stale: false,
    });
  });

  it('does not append to price history when the price is unchanged', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [result()], DAY2);
    expect(day2.deals[0]!.priceHistory).toHaveLength(1);
  });
});

describe('a price change', () => {
  it('updates the deal rather than creating a new one, and records the move', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [result({ deals: [scrapedDeal({ priceUsd: 8.99 })] })], DAY2);

    expect(day2.deals).toHaveLength(1);
    expect(day2.deals[0]!.priceUsd).toBe(8.99);
    // The point of excluding price from the fingerprint.
    expect(day2.deals[0]!.firstSeen).toBe(DAY1.toISOString());
    expect(day2.deals[0]!.priceHistory.map((p) => p.priceUsd)).toEqual([7.99, 8.99]);
  });
});

describe('a downsized pizza', () => {
  it('is a different deal, so a shrink cannot hide behind an unchanged name', () => {
    const day1 = merge(null, [result()], DAY1);
    const shrunk = result({
      sizes: [{ sizeLabel: 'Large', shape: 'round', diameterIn: 13, sourceUrl: 'https://x/menu' }],
      deals: [scrapedDeal()],
    });
    const day2 = merge(day1, [shrunk], DAY2);

    // Old deal deactivated, new one created — the change is visible rather than silent.
    expect(day2.deals).toHaveLength(2);
    const active = day2.deals.filter((d) => d.active);
    expect(active).toHaveLength(1);
    expect(active[0]!.pizzaItems[0]!.diameterIn).toBe(13);
    expect(active[0]!.firstSeen).toBe(DAY2.toISOString());
  });
});

describe('a deal that disappears', () => {
  it('is deactivated and marked stale, never deleted', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [result({ deals: [] , status: 'partial'})], DAY2);

    expect(day2.deals).toHaveLength(1);
    expect(day2.deals[0]).toMatchObject({ active: false, stale: true });
    // The historical record survives.
    expect(day2.deals[0]!.firstSeen).toBe(DAY1.toISOString());
  });
});

describe('a failed scrape', () => {
  const failure = result({
    status: 'failed',
    deals: [],
    sizes: [],
    errors: ['No deal cards found; selectors are stale.'],
  });

  it('keeps the last known good data and marks it stale', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [failure], DAY2);

    expect(day2.deals).toHaveLength(1);
    expect(day2.deals[0]).toMatchObject({ active: true, stale: true, priceUsd: 7.99 });
    // Crucially it is NOT deactivated — we do not know that the offer ended, only that
    // we failed to look.
    expect(day2.deals[0]!.active).toBe(true);
  });

  it('does not erase the scraped diameters everything depends on', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [failure], DAY2);
    expect(day2.sizes.filter((s) => s.chain === 'dominos')).toHaveLength(2);
  });

  it('records the failure and preserves when the chain last worked', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [failure], DAY2);

    const status = day2.chainStatus.find((s) => s.chain === 'dominos')!;
    expect(status.status).toBe('failed');
    expect(status.lastSuccessfulAt).toBe(DAY1.toISOString());
    expect(status.errors[0]).toMatch(/selectors are stale/i);
  });

  it('recovers cleanly when the scraper starts working again', () => {
    const day1 = merge(null, [result()], DAY1);
    const day2 = merge(day1, [failure], DAY2);
    const day3 = merge(day2, [result()], DAY3);

    expect(day3.deals).toHaveLength(1);
    expect(day3.deals[0]).toMatchObject({ stale: false, active: true });
    expect(day3.deals[0]!.firstSeen).toBe(DAY1.toISOString());
    expect(day3.chainStatus.find((s) => s.chain === 'dominos')!.status).toBe('ok');
  });
});

describe('chain isolation', () => {
  it('leaves other chains untouched when one is scraped', () => {
    const both = merge(
      null,
      [result(), result({ chain: 'pizza_hut', deals: [scrapedDeal({ dealName: 'Big Dinner Box' })] })],
      DAY1,
    );
    expect(both.deals).toHaveLength(2);

    // Only Domino's runs today.
    const next = merge(both, [result()], DAY2);
    const pizzaHut = next.deals.filter((d) => d.chain === 'pizza_hut');
    expect(pizzaHut).toHaveLength(1);
    expect(pizzaHut[0]).toMatchObject({ lastSeen: DAY1.toISOString(), stale: false });
  });

  it('does not let one chain\'s failure affect another', () => {
    const both = merge(
      null,
      [result(), result({ chain: 'pizza_hut', deals: [scrapedDeal({ dealName: 'Big Dinner Box' })] })],
      DAY1,
    );
    const next = merge(
      both,
      [result({ status: 'failed', deals: [], sizes: [], errors: ['boom'] }), result({ chain: 'pizza_hut', deals: [scrapedDeal({ dealName: 'Big Dinner Box' })] })],
      DAY2,
    );

    expect(next.deals.find((d) => d.chain === 'dominos')!.stale).toBe(true);
    expect(next.deals.find((d) => d.chain === 'pizza_hut')!.stale).toBe(false);
  });
});

describe('snapshot shape', () => {
  it('carries unparsed offers through so they stay reviewable', () => {
    const snapshot = merge(
      null,
      [result({ status: 'partial', unparsed: [{ raw: 'Free breadsticks', reason: 'No pizza' }] })],
      DAY1,
    );
    expect(snapshot.chainStatus[0]!.unparsed).toHaveLength(1);
  });

  it('stamps a version so the format can change safely', () => {
    expect(merge(null, [result()], DAY1).version).toBe(1);
  });
});

describe('chains with no scraper', () => {
  it('are not reported as healthy just because nothing went wrong', () => {
    // The seed snapshot covers three chains but only Domino's has a scraper. Reporting
    // "ok" for the other two would claim a successful scrape that never happened.
    const previous: Snapshot = {
      version: 1,
      capturedAt: DAY1.toISOString(),
      pricingLocale: 'san-diego-ca',
      chains: CHAINS,
      chainStatus: [
        {
          chain: 'pizza_hut',
          displayName: 'Pizza Hut',
          status: 'never_scraped',
          lastSuccessfulAt: null,
          errors: [],
          unparsed: [],
        },
      ],
      sizes: [],
      crusts: [],
      componentValues: [],
      deliveryFees: [],
      deals: [],
    };

    const next = merge(previous, [result()], DAY2);
    const pizzaHut = next.chainStatus.find((s) => s.chain === 'pizza_hut')!;
    expect(pizzaHut.status).toBe('never_scraped');
    expect(pizzaHut.lastSuccessfulAt).toBeNull();
  });
});
