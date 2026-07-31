import { DealBrowser } from '@/components/DealBrowser';
import { FreshnessBar } from '@/components/FreshnessBar';
import { PixelIcon } from '@/components/PixelIcon';
import { getDealFeed } from '@/lib/data/deals';

// Data is baked at build time; the daily job rebuilds and redeploys.
export const dynamic = 'force-static';

export default async function Home() {
  const feed = await getDealFeed();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 space-y-4">
        <div className="pixel-panel bg-panelLit p-6 text-center">
          <div className="mb-3 flex justify-center gap-2">
            <PixelIcon name="pizza" size={48} />
            <PixelIcon name="coin" size={48} />
            <PixelIcon name="trophy" size={48} />
          </div>
          <h1 className="font-pixel text-xl leading-relaxed text-gold sm:text-2xl">
            PIZZA VALUE QUEST
          </h1>
          <p className="mt-3 font-pixel text-[10px] leading-relaxed text-dim">
            NATIONAL DEALS FROM THE BIG THREE, RANKED BY COST PER SQUARE INCH.
            <br />
            BECAUSE A 14&quot; PIZZA IS 96% BIGGER THAN A 10&quot;, NOT 40%.
            <span className="blink text-gold"> _</span>
          </p>
        </div>

        {/*
          Provenance banner. The app's whole value is honest comparison, so where the
          numbers came from is headline information, not a footer disclaimer.
        */}
        {feed.hasUnverifiedData && (
          <div className="pixel-panel border-crust p-4">
            <p className="flex items-start gap-3 font-body text-xs leading-relaxed text-crust">
              <PixelIcon name="warning" size={24} className="shrink-0" />
              <span>
                UNVERIFIED DATA. PRICES WERE HAND-ENTERED FROM THIRD-PARTY COUPON SITES,
                NOT READ FROM THE CHAINS&apos; OWN PAGES, AND ARE NOT CONFIRMED. SOURCES
                DISAGREE ON SOME PIZZA DIAMETERS — PAPA JOHN&apos;S LARGE IS LISTED AS BOTH
                13.5&quot; AND 14&quot;, WHICH MOVES ITS RANKING BY ~7.5%. CHECK THE CHAIN
                BEFORE ORDERING.
              </span>
            </p>
          </div>
        )}

        <FreshnessBar
          capturedAt={feed.capturedAt}
          pricingLocale={feed.pricingLocale}
          source={feed.source}
          chains={feed.chainStatus.map((c) => ({
            chain: c.chain,
            displayName: c.displayName,
            lastVerifiedAt: c.lastVerifiedAt.toISOString(),
            flaggedStale: c.stale,
          }))}
        />
      </header>

      <DealBrowser deals={feed.deals} deliveryFees={feed.deliveryFees} />

      <footer className="mt-8 border-4 border-crt bg-panel p-4 font-body text-xs leading-relaxed text-dim">
        <p>
          PRICES ARE REFERENCE PRICING FOR {feed.pricingLocale.toUpperCase()} AND VARY BY
          FRANCHISE. BUNDLE VALUES CREDIT SIDES AT FULL MENU PRICE — THE ASSUMPTION IS
          PRINTED ON EACH CARD.
        </p>
      </footer>
    </main>
  );
}
