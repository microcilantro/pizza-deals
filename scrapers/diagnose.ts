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
  'choose your location',
  'find a store',
  'enter your address',
  'start your order',
];


/** Runs in the page. Plain JS source — see the note in describePage for why. */
const DOM_SUMMARY_JS = `(() => {
  var all = Array.prototype.slice.call(document.querySelectorAll('*'));

  var dataAttrs = {};
  for (var i = 0; i < all.length; i++) {
    var attrs = all[i].attributes;
    for (var j = 0; j < attrs.length; j++) {
      var a = attrs[j];
      if (a.name.indexOf('data-') !== 0) continue;
      if (dataAttrs[a.name]) dataAttrs[a.name].count++;
      else dataAttrs[a.name] = { count: 1, sample: String(a.value).slice(0, 50) };
    }
  }

  function describe(node, depth) {
    var parts = [];
    for (var d = 0; d < depth && node; d++) {
      var id = node.id ? '#' + node.id : '';
      var cn = typeof node.className === 'string' ? node.className.trim() : '';
      var cls = cn ? '.' + cn.split(/\\s+/).slice(0, 3).join('.') : '';
      var data = '';
      var at = node.attributes || [];
      for (var k = 0; k < at.length; k++) {
        if (at[k].name.indexOf('data-') === 0) data += '[' + at[k].name + '="' + String(at[k].value).slice(0, 28) + '"]';
      }
      parts.unshift(node.tagName.toLowerCase() + id + cls + data);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  var money = [];
  for (var m = 0; m < all.length && money.length < 25; m++) {
    var el = all[m];
    if (el.children.length > 0) continue;
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!/\\$\\s?\\d/.test(text) || text.length > 60) continue;
    money.push(text + '  <<  ' + describe(el, 4));
  }

  var repeats = [];
  for (var r = 0; r < all.length && repeats.length < 20; r++) {
    var p = all[r];
    var kids = Array.prototype.slice.call(p.children);
    if (kids.length < 3) continue;
    function sig(k) {
      var c = typeof k.className === 'string' ? k.className.trim().split(/\\s+/)[0] || '' : '';
      return k.tagName + '.' + c;
    }
    var first = sig(kids[0]);
    var same = kids.filter(function (k) { return sig(k) === first; }).length;
    if (same < 3 || same / kids.length < 0.8) continue;
    var pcn = typeof p.className === 'string' ? p.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    repeats.push(same + 'x ' + first + '  inside  ' + p.tagName.toLowerCase() + (pcn ? '.' + pcn : '') + (p.id ? '#' + p.id : ''));
  }

  var attrLines = Object.keys(dataAttrs)
    .map(function (n) { return { n: n, c: dataAttrs[n].count, s: dataAttrs[n].sample }; })
    .sort(function (a, b) { return b.c - a.c; })
    .slice(0, 30)
    .map(function (e) { return String(e.c) + '  ' + e.n + ' = "' + e.s + '"'; });

  return { dataAttrs: attrLines, money: money, repeats: repeats, totalElements: all.length };
})()`;

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
  /*
   * Passed as a source string, not a closure. tsx compiles this file with esbuild's
   * keepNames enabled, which rewrites function declarations to call a `__name` helper —
   * that helper does not exist inside the page, so a serialized closure dies with
   * "__name is not defined". A string is handed to the browser untouched.
   */
  const summary = (await page.evaluate(DOM_SUMMARY_JS)) as {
    dataAttrs: string[];
    money: string[];
    repeats: string[];
    totalElements: number;
  };

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
