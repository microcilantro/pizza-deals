/**
 * Manual scraper entry point.
 *
 *   npx tsx scrapers/run.ts dominos
 *
 * Prints a summary and exits non-zero on failure so a scheduled job can alert on it.
 * Persistence and staleness marking are deliberately not here — that is step 6, and
 * keeping the scraper free of database access is what lets it be tested without one.
 */
import { chromium } from 'playwright';
import { scrapeDominos } from './dominos';
import type { ScrapeResult } from './types';

const SCRAPERS: Record<string, (browser: import('playwright').Browser, o: { artifactDir: string }) => Promise<ScrapeResult>> = {
  dominos: scrapeDominos,
};

async function main() {
  const requested = process.argv[2] ?? 'dominos';
  const scraper = SCRAPERS[requested];
  if (!scraper) {
    console.error(`Unknown chain "${requested}". Known: ${Object.keys(SCRAPERS).join(', ')}`);
    process.exit(2);
  }

  const artifactDir = process.env.SCRAPER_ARTIFACT_DIR ?? 'scraper-artifacts';
  const browser = await chromium.launch();

  try {
    const result = await scraper(browser, { artifactDir });

    console.log(`\n[${result.chain}] status=${result.status}`);
    console.log(`  sizes:    ${result.sizes.length}`);
    console.log(`  deals:    ${result.deals.length}`);
    console.log(`  unparsed: ${result.unparsed.length}`);
    for (const u of result.unparsed) console.log(`    - ${u.reason} :: ${u.raw.slice(0, 90)}`);
    for (const e of result.errors) console.log(`  ERROR: ${e}`);
    for (const s of result.screenshotPaths) console.log(`  artifact: ${s}`);

    process.exit(result.status === 'failed' ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('Scraper crashed:', error);
  process.exit(1);
});
