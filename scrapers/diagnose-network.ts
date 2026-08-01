/**
 * Network diagnostics: what data endpoints does a chain's own front end call?
 *
 *   npx tsx scrapers/diagnose-network.ts papa_johns
 *
 * Loads the chain's deals page in a real browser and records every JSON response the
 * page fetches, then reports which ones actually carry deal data.
 *
 * This is the generalised version of what worked for Domino's. Guessing endpoint URLs
 * wastes a round trip per attempt; the page already knows them, so we watch it ask.
 *
 * Read-only, and only observational: it navigates to one public page (after checking
 * robots.txt for it) and listens. It initiates no requests of its own beyond that
 * navigation, which is exactly what a browser visiting the page would do.
 *
 * For each candidate it reports the signals that decide usefulness:
 *   - does the body contain prices?
 *   - does it contain a size stated in inches? (requirement 1 lives or dies here)
 *   - does it look like a coupon/deal list?
 */
import { chromium } from 'playwright';
import { createSession } from './session';

/**
 * Several candidate paths per chain. Papa John's robots.txt disallows /order/deals, so
 * the first question is not "which endpoint serves the data" but "what are we permitted
 * to read at all" — and a disallow is a stop, never something to work around.
 */
const TARGETS: Record<string, { origin: string; candidates: string[] }> = {
  papa_johns: {
    origin: 'https://www.papajohns.com',
    candidates: [
      'https://www.papajohns.com/order/deals',
      'https://www.papajohns.com/deals',
      'https://www.papajohns.com/specials',
      'https://www.papajohns.com/order/menu',
      'https://www.papajohns.com/',
    ],
  },
  pizza_hut: {
    origin: 'https://www.pizzahut.com',
    candidates: [
      'https://www.pizzahut.com/deals',
      'https://www.pizzahut.com/menu/deals',
      'https://www.pizzahut.com/menu',
      'https://www.pizzahut.com/',
    ],
  },
};

const INCHES = /(\d{1,2}(?:\.\d)?)\s*(?:"|''|inch(?:es)?|in\b)/i;
const MONEY = /(?:"[Pp]rice"|\$\s?\d|\d+\.\d{2})/;
const DEALISH = /coupon|deal|offer|promo/i;

interface Capture {
  url: string;
  status: number;
  bytes: number;
  hasMoney: boolean;
  hasInches: boolean;
  inchSample: string | null;
  dealish: boolean;
  topKeys: string;
}

async function main() {
  const chain = process.argv[2] ?? 'papa_johns';
  const target = TARGETS[chain];
  if (!target) {
    console.error(`Unknown chain "${chain}". Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const { session, context } = await createSession(browser, {
    chain,
    artifactDir: process.env.SCRAPER_ARTIFACT_DIR ?? 'scraper-artifacts',
  });

  const captures: Capture[] = [];

  try {
    await session.loadRobots(target.origin);

    // Report the whole permission picture before touching anything.
    console.log(`\n== ROBOTS.TXT (${target.origin}) ==`);
    const allowed: string[] = [];
    for (const candidate of target.candidates) {
      const ok = session.isAllowed(candidate);
      console.log(`  ${ok ? 'ALLOWED ' : 'DISALLOW'}  ${candidate}`);
      if (ok) allowed.push(candidate);
    }

    if (allowed.length === 0) {
      console.log('\n!! Every candidate path is disallowed by robots.txt.');
      console.log('!! This chain cannot be scraped from these pages. Not a bug to fix.');
      return;
    }

    const chosen = allowed[0]!;
    console.log(`\nusing first allowed path: ${chosen}`);
    const page = await session.open(chosen);

    page.on('response', (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('json')) return;

      void response
        .text()
        .then((body) => {
          if (!body || body.length < 40) return;
          const inch = body.match(INCHES);
          let topKeys = '';
          try {
            const parsed = JSON.parse(body);
            topKeys = Array.isArray(parsed)
              ? `[array of ${parsed.length}]`
              : Object.keys(parsed).slice(0, 12).join(', ');
          } catch {
            topKeys = '(unparseable)';
          }
          captures.push({
            url: response.url().slice(0, 150),
            status: response.status(),
            bytes: body.length,
            hasMoney: MONEY.test(body),
            hasInches: inch !== null,
            inchSample: inch ? body.slice(Math.max(0, inch.index! - 60), inch.index! + 30) : null,
            dealish: DEALISH.test(response.url()) || DEALISH.test(body.slice(0, 4000)),
            topKeys,
          });
        })
        .catch(() => {});
    });

    // Deal lists load lazily; give the app time to make its calls.
    void 0;
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(6_000);

    console.log(`\n${'='.repeat(78)}\n== ${chain.toUpperCase()}\n${'='.repeat(78)}`);
    console.log(`landed on: ${page.url()}`);
    console.log(`title    : ${await page.title()}`);

    const text = (await page.locator('body').innerText().catch(() => '')) ?? '';
    console.log(`page text: ${text.replace(/\s+/g, ' ').slice(0, 260)}`);

    console.log(`\n-- ${captures.length} JSON responses observed --`);
    const interesting = captures
      .filter((c) => c.hasMoney || c.hasInches || c.dealish)
      .sort((a, b) => Number(b.hasInches) - Number(a.hasInches) || b.bytes - a.bytes);

    for (const c of interesting.slice(0, 20)) {
      console.log(
        `\n  ${c.status}  ${c.bytes}b  money=${c.hasMoney} inches=${c.hasInches} dealish=${c.dealish}`,
      );
      console.log(`  ${c.url}`);
      console.log(`  keys: ${c.topKeys}`);
      if (c.inchSample) console.log(`  inch context: ...${c.inchSample.replace(/\s+/g, ' ')}...`);
    }

    if (interesting.length === 0) {
      console.log('  None carried prices, inches, or deal-shaped content.');
      console.log('  Either the page renders server-side, or the data arrives another way.');
    }

    await page.close();
  } catch (error) {
    console.error(`[${chain}] network diagnosis failed:`, error);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Network diagnosis crashed:', error);
  process.exit(1);
});
