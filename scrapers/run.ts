/**
 * Daily scrape entry point.
 *
 *   npx tsx scrapers/run.ts             # all chains
 *   npx tsx scrapers/run.ts dominos     # one chain
 *
 * Scrapes, merges into the newest snapshot, and writes a new dated snapshot file. The
 * workflow commits that file and rebuilds the site.
 *
 * Exit codes matter to the scheduled job:
 *   0  at least one chain produced usable data
 *   1  every chain failed — the snapshot still carries yesterday's data, marked stale
 *   2  bad invocation
 */
import { chromium, type Browser } from 'playwright';
import { seedSnapshot } from '@/lib/snapshot/fromSeed';
import { loadLatestSnapshot, writeSnapshot } from '@/lib/snapshot/load';
import { mergeScrape } from '@/lib/snapshot/merge';
import { scrapeDominos } from './dominos';
import type { ScrapeResult } from './types';

type Scraper = (browser: Browser | null, options: { artifactDir: string }) => Promise<ScrapeResult>;

/**
 * `needsBrowser` exists because Domino's is read from JSON endpoints rather than
 * rendered HTML, so launching Chromium for it would be pure cost. Chains whose data
 * only exists in a rendered page will set it true.
 */
const SCRAPERS: Record<string, { run: Scraper; needsBrowser: boolean }> = {
  dominos: { run: scrapeDominos, needsBrowser: false },
};

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const chains = requested.length > 0 ? requested : Object.keys(SCRAPERS);

  const unknown = chains.filter((c) => !SCRAPERS[c]);
  if (unknown.length > 0) {
    console.error(
      `Unknown chain(s): ${unknown.join(', ')}. Known: ${Object.keys(SCRAPERS).join(', ')}`,
    );
    process.exit(2);
  }

  const artifactDir = process.env.SCRAPER_ARTIFACT_DIR ?? 'scraper-artifacts';
  const needsBrowser = chains.some((c) => SCRAPERS[c]?.needsBrowser);
  const browser = needsBrowser ? await chromium.launch() : null;
  const results: ScrapeResult[] = [];

  try {
    for (const chain of chains) {
      // Each chain is isolated: a crash in one must not stop the others, which is the
      // whole reason the scrapers are separate modules.
      try {
        results.push(await SCRAPERS[chain]!.run(browser, { artifactDir }));
      } catch (error) {
        console.error(`[${chain}] crashed outside its own error handling:`, error);
        results.push({
          chain,
          status: 'failed',
          startedAt: new Date(),
          finishedAt: new Date(),
          sizes: [],
          crusts: [],
          menuPrices: [],
          deals: [],
          unparsed: [],
          errors: [error instanceof Error ? error.message : String(error)],
          screenshotPaths: [],
        });
      }
    }
  } finally {
    await browser?.close();
  }

  const previous = (await loadLatestSnapshot()) ?? seedSnapshot();
  const snapshot = mergeScrape(previous, results, {
    now: new Date(),
    pricingLocale: previous.pricingLocale,
    chains: previous.chains,
  });
  const file = await writeSnapshot(snapshot);

  console.log(`\nWrote ${file}`);
  for (const status of snapshot.chainStatus) {
    const deals = snapshot.deals.filter((d) => d.chain === status.chain && d.active);
    const stale = deals.filter((d) => d.stale).length;
    const label = status.status === 'never_scraped' ? 'no scraper' : status.status;
    console.log(
      `  ${status.chain.padEnd(12)} ${label.padEnd(12)} ` +
        `${deals.length} active${stale > 0 ? `, ${stale} stale` : ''}`,
    );
    for (const error of status.errors) console.log(`      ERROR: ${error}`);
    for (const u of status.unparsed) console.log(`      unparsed: ${u.reason}`);
  }

  const anyUsable = results.some((r) => r.status !== 'failed');
  if (!anyUsable) {
    console.error(
      `\nEvery chain scraped this run (${chains.join(', ')}) failed. ` +
        'The snapshot retains their previous data, marked stale.',
    );
  }
  process.exit(anyUsable ? 0 : 1);
}

main().catch((error) => {
  console.error('Scrape run crashed:', error);
  process.exit(1);
});
