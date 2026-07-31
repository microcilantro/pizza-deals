/**
 * Writes the hand-entered seed dataset out as snapshot zero.
 *
 *   npx tsx scripts/seed-snapshot.ts
 *
 * Only needed once, to bootstrap `data/snapshots/`. After that the daily scrape merges
 * on top of the newest snapshot.
 */
import { seedSnapshot } from '@/lib/snapshot/fromSeed';
import { writeSnapshot } from '@/lib/snapshot/load';

const snapshot = seedSnapshot();
writeSnapshot(snapshot)
  .then((file) => {
    console.log(`Wrote ${file}`);
    console.log(`  deals: ${snapshot.deals.length}, sizes: ${snapshot.sizes.length}`);
    console.log('  provenance: manual_secondary (unverified against the chains\' own pages)');
  })
  .catch((error) => {
    console.error('Failed to write seed snapshot:', error);
    process.exit(1);
  });
