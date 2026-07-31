import { DealBrowser } from '@/components/DealBrowser';
import { PixelIcon } from '@/components/PixelIcon';
import { getDealFeed } from '@/lib/data/deals';

// Deals change at most daily, so revalidate hourly rather than per request.
export const revalidate = 3600;

export default async function Home() {
  const feed = await getDealFeed();
  const staleChains = feed.chainStatus.filter((c) => c.stale);

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

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-4 border-crt bg-panel px-4 py-3 font-pixel text-[10px] text-dim">
          <span>
            UPDATED <span className="text-ink">{feed.capturedAt}</span>
          </span>
          <span>
            MARKET <span className="text-ink">{feed.pricingLocale.toUpperCase()}</span>
          </span>
          <span>
            SOURCE <span className="text-ink">{feed.source.toUpperCase()}</span>
          </span>
          {staleChains.length > 0 && (
            <span className="flex items-center gap-2 text-flame">
              <PixelIcon name="warning" size={16} />
              STALE: {staleChains.map((c) => c.displayName.toUpperCase()).join(', ')}
            </span>
          )}
        </div>
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
