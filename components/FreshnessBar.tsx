'use client';

import { useEffect, useState } from 'react';
import { ageInDays, isStaleAt } from '@/lib/freshness';
import { PixelIcon } from './PixelIcon';

/**
 * Data freshness, computed in the browser rather than at build time.
 *
 * This has to be a client component. On a static export the page is rendered once, when
 * the site is built, so anything comparing `lastVerifiedAt` against `new Date()` on the
 * server freezes at that moment — a site built five days ago would go on reporting its
 * data as fresh forever, and the stale indicator would silently never fire. Since the
 * whole point of the indicator is to catch a scraper that has stopped working, a version
 * that cannot fire is worse than none at all.
 *
 * The age is therefore measured against the reader's clock, at read time.
 */

export interface ChainFreshness {
  chain: string;
  displayName: string;
  /** ISO string; Date objects do not survive the server/client boundary intact. */
  lastVerifiedAt: string;
  /** Marked stale by the scraper itself, independent of age. */
  flaggedStale: boolean;
}

interface FreshnessBarProps {
  capturedAt: string;
  pricingLocale: string;
  source: string;
  chains: ChainFreshness[];
}

export function FreshnessBar({ capturedAt, pricingLocale, source, chains }: FreshnessBarProps) {
  // Rendered only after mount, so the server-rendered HTML and the first client render
  // agree and hydration stays clean.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);

  const stale = chains.filter((chain) => {
    if (chain.flaggedStale) return true;
    if (now === null) return false;
    return isStaleAt(chain.lastVerifiedAt, now);
  });

  const ageDays = now === null ? null : ageInDays(capturedAt, now);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-4 border-crt bg-panel px-4 py-3 font-pixel text-[10px] text-dim">
      <span>
        UPDATED <span className="text-ink">{capturedAt}</span>
        {ageDays !== null && ageDays > 0 && (
          <span className={ageDays > 2 ? 'text-flame' : 'text-dim'}>
            {' '}
            ({ageDays}D AGO)
          </span>
        )}
      </span>
      <span>
        MARKET <span className="text-ink">{pricingLocale.toUpperCase()}</span>
      </span>
      <span>
        SOURCE <span className="text-ink">{source.toUpperCase()}</span>
      </span>

      {stale.length > 0 && (
        <span className="flex items-center gap-2 text-flame">
          <PixelIcon name="warning" size={16} />
          STALE: {stale.map((c) => c.displayName.toUpperCase()).join(', ')} — SCRAPER HAS NOT
          CONFIRMED THESE RECENTLY
        </span>
      )}
    </div>
  );
}
