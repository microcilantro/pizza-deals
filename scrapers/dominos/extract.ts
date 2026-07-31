import type { Locator, Page } from 'playwright';
import type { RawDealCard, RawMenuSize } from '../types';

/**
 * DOM extraction for Domino's.
 *
 * ============================== UNVERIFIED SELECTORS ==============================
 * The selectors below have NOT been checked against the live site — this build
 * environment cannot reach dominos.com. They are informed guesses based on the page
 * structure the deals and menu pages are known to use, and the first real run should be
 * expected to need at least some of them corrected.
 *
 * The code is arranged so that correcting them is cheap and low-risk: every selector is
 * a named constant in one object, each one has a list of fallbacks tried in order, and
 * nothing downstream of `extractDealCards` depends on the DOM at all. When a selector
 * rots, `parse.ts` and its 44 tests are unaffected — you edit one string here.
 *
 * `extractDealCards` returning an empty array is treated as failure by the caller, not
 * as "no deals today", precisely because a silent empty result is the failure mode this
 * design is guarding against.
 * =================================================================================
 */

export const SELECTORS = {
  /** Containers holding one offer each. */
  dealCard: [
    '[data-quid^="coupon-card"]',
    '[data-testid*="coupon" i]',
    '.coupon-card',
    'article[class*="coupon" i]',
  ],
  dealTitle: ['[data-quid$="title"]', 'h2', 'h3', '[class*="title" i]'],
  dealDescription: ['[data-quid$="description"]', 'p', '[class*="description" i]'],
  dealPrice: ['[data-quid$="price"]', '[class*="price" i]'],
  dealPromoCode: ['[data-quid$="code"]', '[class*="code" i]'],
  dealFulfillment: ['[data-quid$="service-method"]', '[class*="service" i]', '[class*="method" i]'],
  dealValidThrough: ['[class*="expir" i]', '[class*="valid" i]', 'small'],

  /** Menu page: rows describing each size, which is where diameter must come from. */
  menuSizeRow: [
    '[data-quid^="size-"]',
    '[data-testid*="size" i]',
    '.size-option',
    'li[class*="size" i]',
  ],
  menuSizeLabel: ['[data-quid$="label"]', 'h3', '[class*="name" i]'],
  menuSizeDescription: ['[data-quid$="description"]', 'p', '[class*="detail" i]'],
  menuSizePrice: ['[data-quid$="price"]', '[class*="price" i]'],
  menuCrustRow: ['[data-quid^="crust-"]', '.crust-option', 'li[class*="crust" i]'],

  /** Cookie/consent overlays that block content if not dismissed. */
  dismissable: [
    'button[aria-label*="accept" i]',
    'button[aria-label*="close" i]',
    '#onetrust-accept-btn-handler',
  ],
} as const;

/** Bounded per-selector wait. See `firstMatchingText` for why this must not be the default. */
const SELECTOR_TIMEOUT_MS = 500;

type TextScope = { locator: (selector: string) => Locator };

/**
 * Tries each selector in order and returns the first that matches anything.
 *
 * The `count()` check before `textContent()` is load-bearing. Playwright's default
 * action timeout is 30 seconds, and `textContent()` on a selector that matches nothing
 * waits the whole of it. With four fallbacks across six fields per card, a page of
 * twenty coupons would spend hours failing. `count()` resolves immediately, so we only
 * pay the timeout on selectors that actually matched.
 */
async function firstMatchingText(
  scope: TextScope,
  selectors: readonly string[],
): Promise<string | null> {
  for (const selector of selectors) {
    try {
      const locator = scope.locator(selector).first();
      if ((await locator.count()) === 0) continue;
      const text = await locator.textContent({ timeout: SELECTOR_TIMEOUT_MS });
      if (text && text.trim()) return text.trim().replace(/\s+/g, ' ');
    } catch {
      // Selector did not match or timed out; try the next one.
    }
  }
  return null;
}

/** Best-effort dismissal of consent overlays, which otherwise hide the deal list. */
export async function dismissOverlays(page: Page): Promise<void> {
  for (const selector of SELECTORS.dismissable) {
    try {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0) continue;
      if (await button.isVisible()) {
        await button.click({ timeout: 2000 });
      }
    } catch {
      // Nothing to dismiss.
    }
  }
}

export async function extractDealCards(page: Page, sourceUrl: string): Promise<RawDealCard[]> {
  await dismissOverlays(page);

  for (const cardSelector of SELECTORS.dealCard) {
    const cards = page.locator(cardSelector);
    const count = await cards.count().catch(() => 0);
    if (count === 0) continue;

    const results: RawDealCard[] = [];
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const title = await firstMatchingText(card, SELECTORS.dealTitle);
      if (!title) continue;

      results.push({
        title,
        description: (await firstMatchingText(card, SELECTORS.dealDescription)) ?? '',
        priceText: await firstMatchingText(card, SELECTORS.dealPrice),
        promoCode: await firstMatchingText(card, SELECTORS.dealPromoCode),
        fulfillmentText: await firstMatchingText(card, SELECTORS.dealFulfillment),
        validThroughText: await firstMatchingText(card, SELECTORS.dealValidThrough),
        sourceUrl,
      });
    }

    if (results.length > 0) return results;
  }

  return [];
}

export async function extractMenuSizes(page: Page): Promise<RawMenuSize[]> {
  await dismissOverlays(page);

  for (const rowSelector of SELECTORS.menuSizeRow) {
    const rows = page.locator(rowSelector);
    const count = await rows.count().catch(() => 0);
    if (count === 0) continue;

    const results: RawMenuSize[] = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const label = await firstMatchingText(row, SELECTORS.menuSizeLabel);
      if (!label) continue;

      results.push({
        label,
        descriptionText: (await firstMatchingText(row, SELECTORS.menuSizeDescription)) ?? label,
        priceText: await firstMatchingText(row, SELECTORS.menuSizePrice),
        crustText: await firstMatchingText(row, SELECTORS.menuCrustRow),
      });
    }

    if (results.length > 0) return results;
  }

  return [];
}
