/**
 * Selector diagnostics.
 *
 *   npx tsx scrapers/diagnose.ts dominos
 *
 * Runs against a chain's live pages and prints enough of the DOM's *shape* to write
 * correct selectors from — without needing to download the page.
 *
 * This exists because the environment the scraper is developed in cannot reach the
 * chains' sites, but the CI runner can. Rather than guessing selectors and waiting a day
 * to find out, this dumps a structural summary to the workflow log, which is readable
 * from anywhere.
 *
 * It answers, in order of importance:
 *   1. What page did we actually land on? (A bot wall or a store-picker looks nothing
 *      like a coupon list, and no selector will ever fix that.)
 *   2. Which of our current selectors matched, and how many elements?
 *   3. Where does the money live, and what identifies those elements?
 *   4. What repeated structures exist that look like card lists?
 *
 * Read-only. It never writes a snapshot.
 */
import { chromium, type Page } from 'playwright';
import { createSession } from './session';
import { DOMINOS } from './dominos';
import { SELECTORS } from './dominos/extract';

const TARGETS: Record<string, { origin: string; pages: { label: string; url: string }[] }> = {
  dominos: {
    origin: DOMINOS.origin,
    pages: [
      { label: 'deals', url: DOMINOS.dealsUrl },
      { label: 'menu', url: DOMINOS.menuUrl },
    ],
  },
};

/** Signals that we are not looking at the page we think we are. */
const WALL_MARKERS = [
  'access denied',
  'unusual traffic',
  'are you a robot',
  'verify you are human',
  'enable javascript',
  'something went wrong',
  'choose a store',
  'find a store',
  'enter your address',
];

async function describePage(page: Page, label: string): Promise<void> {
  console.log(`\n${'='.repeat(78)}\n== ${label.toUpperCase()}\n${'='.repeat(78)}`);
  console.log(`final url : ${page.url()}`);
  console.log(`title     : ${await page.title()}`);

  const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
  const flat = bodyText.replace(/\s+/g, ' ').trim();
  console.log(`text len  : ${flat.length}`);
  console.log(`text head : ${flat.slice(0, 400)}`);

  const hits = WALL_MARKERS.filter((m) => flat.toLowerCase().includes(m));
  if (hits.length > 0) {
    console.log(`\n!! WALL/GATE MARKERS PRESENT: ${hits.join(', ')}`);
    console.log('!! No selector change fixes this — the page itself is not the deal list.');
  }

  // 2. Do our current selectors match anything?
  console.log('\n-- current selector match counts --');
  for (const [name, list] of Object.entries(SELECTORS)) {
    for (const selector of list as readonly string[]) {
      const count = await page.locator(selector).count().catch(() => -1);
      if (count !== 0) console.log(`  ${name.padEnd(18)} ${String(count).padStart(4)}  ${selector}`);
    }
  }

  // 3/4. What does the DOM actually look like?
  const summary = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('*'));

    // Every distinct data-* attribute name, with a sample value and a count.
    const dataAttrs = new Map<string, { count: number; sample: string }>();
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        if (!attr.name.startsWith('data-')) continue;
        const entry = dataAttrs.get(attr.name);
        if (entry) entry.count += 1;
        else dataAttrs.set(attr.name, { count: 1, sample: attr.value.slice(0, 50) });
      }
    }

    // Elements whose own text carries a price, with what identifies them.
    const money: string[] = [];
    for (const el of all) {
      if (el.children.length > 0) continue; // leaf nodes only
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!/\$\s?\d/.test(text) || text.length > 60) continue;

      const path: string[] = [];
      let node: HTMLElement | null = el;
      for (let i = 0; i < 4 && node; i++) {
        const id = node.id ? `#${node.id}` : '';
        const cls = node.className && typeof node.className === 'string'
          ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
        const data = Array.from(node.attributes)
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => `[${a.name}="${a.value.slice(0, 28)}"]`)
          .join('');
        path.unshift(`${node.tagName.toLowerCase()}${id}${cls}${data}`);
        node = node.parentElement;
      }
      money.push(`${text}  <<  ${path.join(' > ')}`);
      if (money.length >= 25) break;
    }

    // Repeated sibling structures — the shape a card list makes.
    const repeats: string[] = [];
    for (const el of all) {
      const kids = Array.from(el.children) as HTMLElement[];
      if (kids.length < 3) continue;
      const sig = (k: HTMLElement) =>
        `${k.tagName}.${typeof k.className === 'string' ? k.className.trim().split(/\s+/)[0] ?? '' : ''}`;
      const first = sig(kids[0]!);
      const same = kids.filter((k) => sig(k) === first).length;
      if (same < 3 || same / kids.length < 0.8) continue;

      const parentCls =
        typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      repeats.push(
        `${same}x ${first}  inside  ${el.tagName.toLowerCase()}${parentCls ? `.${parentCls}` : ''}${el.id ? `#${el.id}` : ''}`,
      );
      if (repeats.length >= 20) break;
    }

    return {
      dataAttrs: [...dataAttrs.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 30)
        .map(([name, v]) => `${String(v.count).padStart(5)}  ${name} = "${v.sample}"`),
      money,
      repeats,
      totalElements: all.length,
    };
  });

  console.log(`\n-- dom size: ${summary.totalElements} elements --`);

  console.log('\n-- data-* attributes (count, name, sample) --');
  for (const line of summary.dataAttrs) console.log(`  ${line}`);
  if (summary.dataAttrs.length === 0) console.log('  (none — the site does not use data-* hooks)');

  console.log('\n-- price-bearing leaf nodes and their ancestry --');
  for (const line of summary.money) console.log(`  ${line}`);
  if (summary.money.length === 0) console.log('  (no prices found on the page at all)');

  console.log('\n-- repeated sibling structures (candidate card lists) --');
  for (const line of summary.repeats) console.log(`  ${line}`);
  if (summary.repeats.length === 0) console.log('  (none)');
}

async function main() {
  const chain = process.argv[2] ?? 'dominos';
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

  try {
    await session.loadRobots(target.origin);
    for (const { label, url } of target.pages) {
      const page = await session.open(url);
      try {
        // Coupon lists are rendered client-side; give the app a moment to settle.
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await describePage(page, label);
      } catch (error) {
        console.error(`[${label}] diagnosis failed:`, error);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Diagnosis crashed:', error);
  process.exit(1);
});
