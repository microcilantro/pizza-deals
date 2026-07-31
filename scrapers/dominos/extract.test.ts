import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { extractDealCards, extractMenuSizes } from './extract';
import { parseDealCard, parseDiameterIn } from './parse';

/**
 * Extraction tests against fixture HTML loaded with `page.setContent` — a real browser,
 * real selector matching, no network.
 *
 * What these prove: the extraction machinery works — selector fallback order, missing
 * optional fields, and an empty result being distinguishable from a populated one.
 *
 * What these do NOT prove: that the selectors match dominos.com. The fixtures are
 * reconstructions, because this environment cannot reach the live site. Treat a green
 * run here as "the plumbing is sound", not "the scraper works".
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const SOURCE_URL = 'https://www.dominos.com/en/pages/order/#!/section/Coupons/';

let browser: Browser | null = null;

async function launch(): Promise<Browser | null> {
  const { chromium } = await import('playwright');
  // Prefer whatever Playwright resolves; fall back to the image's bundled Chromium when
  // the installed package expects a build revision that is not present.
  try {
    return await chromium.launch();
  } catch {
    const bundled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    try {
      return await chromium.launch({ executablePath: bundled });
    } catch {
      return null;
    }
  }
}

async function pageWith(fixture: string): Promise<Page> {
  const html = await readFile(path.join(FIXTURES, fixture), 'utf8');
  const page = await browser!.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return page;
}

beforeAll(async () => {
  browser = await launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe.runIf(process.env.SKIP_BROWSER_TESTS !== '1')('extractDealCards', () => {
  it('pulls every offer card off the page', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('deals.html');
    const cards = await extractDealCards(page, SOURCE_URL);
    await page.close();

    expect(cards).toHaveLength(5);
    expect(cards[0]).toMatchObject({
      title: 'Large 3-Topping Pizza',
      priceText: '$7.99',
      fulfillmentText: 'Carryout',
      sourceUrl: SOURCE_URL,
    });
  });

  it('leaves optional fields null rather than inventing them', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('deals.html');
    const cards = await extractDealCards(page, SOURCE_URL);
    await page.close();

    const noPrice = cards.find((c) => c.title === 'Free delivery week')!;
    expect(noPrice.priceText).toBeNull();
    expect(noPrice.promoCode).toBeNull();
  });

  it('collapses whitespace so multi-line copy parses', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('deals.html');
    const cards = await extractDealCards(page, SOURCE_URL);
    await page.close();

    const mixMatch = cards.find((c) => c.title === 'Mix & Match')!;
    expect(mixMatch.description).not.toMatch(/\n/);
    expect(mixMatch.description).toContain('2 or more items at $6.99 each');
  });

  it('falls back to class selectors when the markup is redesigned', async () => {
    // The whole point of the fallback list: a redesign that drops data-quid attributes
    // should degrade, not break.
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('deals-redesigned.html');
    const cards = await extractDealCards(page, SOURCE_URL);
    await page.close();

    expect(cards).toHaveLength(1);
    expect(cards[0]!.title).toBe('Large 3-Topping Pizza');
    expect(cards[0]!.priceText).toBe('$7.99');
  });

  it('returns an empty array when nothing matches, so the caller can fail loudly', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await browser.newPage();
    await page.setContent('<main><p>Sorry, our site is down for maintenance.</p></main>');
    const cards = await extractDealCards(page, SOURCE_URL);
    await page.close();

    expect(cards).toEqual([]);
  });
});

describe.runIf(process.env.SKIP_BROWSER_TESTS !== '1')('extractMenuSizes', () => {
  it('reads size rows including the diameter text', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('menu.html');
    const rows = await extractMenuSizes(page);
    await page.close();

    expect(rows.map((r) => r.label)).toEqual(['Small', 'Medium', 'Large', 'Personal']);
    expect(rows.find((r) => r.label === 'Large')!.descriptionText).toContain('14"');
  });

  it('yields diameters that parse out of the page rather than a lookup table', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('menu.html');
    const rows = await extractMenuSizes(page);
    await page.close();

    const diameters = rows.map((r) => parseDiameterIn(`${r.label} ${r.descriptionText}`));
    expect(diameters).toEqual([10, 12, 14, null]);
  });
});

describe.runIf(process.env.SKIP_BROWSER_TESTS !== '1')('extraction feeding the parser', () => {
  it('turns a real-looking page into rankable deals and explicit rejections', async () => {
    if (!browser) return expect.unreachable('Chromium failed to launch');
    const page = await pageWith('deals.html');
    const cards = await extractDealCards(page, SOURCE_URL);
    await page.close();

    const outcomes = cards.map(parseDealCard);
    const deals = outcomes.map((o) => o.deal).filter((d) => d !== null);
    const unparsed = outcomes.map((o) => o.unparsed).filter((u) => u !== null);

    // Three usable pizza offers.
    expect(deals.map((d) => d.dealName)).toEqual([
      'Large 3-Topping Pizza',
      'Mix & Match',
      '$9.99 Large, Any Crust, Any Toppings',
    ]);

    // Per-item pricing multiplied out.
    expect(deals[1]).toMatchObject({ kind: 'multi_pizza', priceUsd: 13.98 });

    // Two rejections, each with a stated reason — nothing disappears quietly.
    expect(unparsed).toHaveLength(2);
    expect(unparsed.map((u) => u.reason)).toEqual([
      expect.stringMatching(/does not appear to contain a pizza/i),
      expect.stringMatching(/no price or percentage discount/i),
    ]);
  });
});
