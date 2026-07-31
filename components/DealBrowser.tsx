'use client';

import { useMemo, useState } from 'react';
import {
  SERVING_PRESETS,
  peopleFed,
  rankDeals,
  rankForPeople,
  targetAreaForPeople,
  type ComparabilityMode,
  type CrustClass,
  type Deal,
  type DealMetrics,
  type Fulfillment,
  type QuantityPlan,
  type Track,
} from '@/lib/normalize';
import { DealCard } from './DealCard';
import { PixelIcon } from './PixelIcon';

type Appetite = keyof typeof SERVING_PRESETS;

interface ViewEntry {
  deal: Deal;
  metrics: DealMetrics;
  rank: number;
  /** Present only in party mode. */
  plan?: QuantityPlan;
}

interface ViewSegment {
  key: string;
  label: string;
  track: Track;
  deals: ViewEntry[];
}

interface DealBrowserProps {
  deals: Deal[];
  deliveryFees: Record<string, number>;
}

const CHAINS = [
  { slug: 'dominos', label: "DOMINO'S" },
  { slug: 'pizza_hut', label: 'PIZZA HUT' },
  { slug: 'papa_johns', label: "PAPA JOHN'S" },
];

const CRUST_CLASSES: { value: CrustClass; label: string }[] = [
  { value: 'standard', label: 'STANDARD' },
  { value: 'thin', label: 'THIN' },
  { value: 'specialty', label: 'SPECIALTY' },
];

const APPETITES: { value: Appetite; label: string }[] = [
  { value: 'light', label: 'LIGHT' },
  { value: 'normal', label: 'NORMAL' },
  { value: 'hearty', label: 'HEARTY' },
];

export function DealBrowser({ deals, deliveryFees }: DealBrowserProps) {
  const [partyMode, setPartyMode] = useState(false);
  const [people, setPeople] = useState(4);
  const [appetite, setAppetite] = useState<Appetite>('normal');

  const [chains, setChains] = useState<string[]>([]);
  const [crustClasses, setCrustClasses] = useState<CrustClass[]>([]);
  const [fulfillment, setFulfillment] = useState<Fulfillment | 'all'>('all');
  const [showBundles, setShowBundles] = useState(true);
  const [includeDeliveryFee, setIncludeDeliveryFee] = useState(false);
  const [comparability, setComparability] = useState<ComparabilityMode>('area');

  const servingModel = SERVING_PRESETS[appetite];

  const filtered = useMemo(
    () =>
      deals.filter((deal) => {
        if (chains.length > 0 && !chains.includes(deal.chain)) return false;
        if (!showBundles && deal.kind === 'bundle') return false;
        if (fulfillment !== 'all' && deal.fulfillment !== fulfillment) return false;
        if (crustClasses.length > 0) {
          const classes = new Set(deal.pizzaItems.map((i) => i.crust.class));
          if (![...classes].some((c) => crustClasses.includes(c))) return false;
        }
        return true;
      }),
    [deals, chains, crustClasses, fulfillment, showBundles],
  );

  const options = { deliveryFees, includeDeliveryFee, comparability };

  const flat = useMemo(() => rankDeals(filtered, options), [filtered, deliveryFees, includeDeliveryFee, comparability]);
  const party = useMemo(
    () => rankForPeople(filtered, people, { ...options, servingModel }),
    [filtered, people, servingModel, deliveryFees, includeDeliveryFee, comparability],
  );

  // Flatten both ranking shapes into one view type so the list renders once. The only
  // difference is that party mode carries a purchase plan.
  const segments: ViewSegment[] = partyMode
    ? party.segments.map((s) => ({
        key: s.key,
        label: s.label,
        track: s.segment.track,
        deals: s.deals.map((d) => ({
          deal: d.deal,
          metrics: d.metrics,
          rank: d.rank,
          plan: d.plan,
        })),
      }))
    : flat.segments.map((s) => ({
        key: s.key,
        label: s.label,
        track: s.segment.track,
        deals: s.deals.map((d) => ({ deal: d.deal, metrics: d.metrics, rank: d.rank })),
      }));

  const ungrouped = partyMode ? party.ungrouped : flat.ungrouped;
  const targetArea = partyMode ? party.targetAreaSqIn : null;

  return (
    <div className="space-y-6">
      <PartyPanel
        partyMode={partyMode}
        setPartyMode={setPartyMode}
        people={people}
        setPeople={setPeople}
        appetite={appetite}
        setAppetite={setAppetite}
        targetAreaSqIn={targetArea}
      />

      <FilterPanel
        chains={chains}
        setChains={setChains}
        crustClasses={crustClasses}
        setCrustClasses={setCrustClasses}
        fulfillment={fulfillment}
        setFulfillment={setFulfillment}
        showBundles={showBundles}
        setShowBundles={setShowBundles}
        includeDeliveryFee={includeDeliveryFee}
        setIncludeDeliveryFee={setIncludeDeliveryFee}
        comparability={comparability}
        setComparability={setComparability}
        hasDeliveryFeeData={Object.keys(deliveryFees).length > 0}
      />

      {segments.length === 0 && ungrouped.length === 0 && (
        <div className="pixel-panel p-8 text-center">
          <p className="font-pixel text-sm text-dim">NO DEALS MATCH THOSE FILTERS.</p>
        </div>
      )}

      {segments.map((segment) => (
        <section key={segment.key} className="pixel-panel">
          <header className="flex items-center gap-3 border-b-4 border-crt bg-panelLit px-4 py-3">
            <PixelIcon name={segment.track === 'bundle' ? 'bundle' : 'pizza'} size={24} />
            <h2 className="font-pixel text-xs uppercase tracking-widest text-gold">
              {segment.label}
            </h2>
            <span className="ml-auto font-pixel text-[10px] text-dim">
              {segment.deals.length} {segment.deals.length === 1 ? 'DEAL' : 'DEALS'}
            </span>
          </header>

          <ul className="divide-y-4 divide-crt">
            {segment.deals.map((entry) => (
              <li key={entry.deal.id}>
                <DealCard
                  deal={entry.deal}
                  metrics={entry.metrics}
                  rank={entry.rank}
                  plan={entry.plan}
                  peopleFedByOffer={peopleFed(entry.metrics.totalAreaSqIn, servingModel)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {ungrouped.length > 0 && <UnrankedPanel entries={ungrouped} />}
    </div>
  );
}

/* ------------------------------------------------------------------ party mode */

function PartyPanel({
  partyMode,
  setPartyMode,
  people,
  setPeople,
  appetite,
  setAppetite,
  targetAreaSqIn,
}: {
  partyMode: boolean;
  setPartyMode: (v: boolean) => void;
  people: number;
  setPeople: (v: number) => void;
  appetite: Appetite;
  setAppetite: (v: Appetite) => void;
  targetAreaSqIn: number | null;
}) {
  const preview = targetAreaForPeople(people, SERVING_PRESETS[appetite]);

  return (
    <section className="pixel-panel">
      <header className="flex flex-wrap items-center gap-3 border-b-4 border-crt bg-panelLit px-4 py-3">
        <PixelIcon name="slice" size={24} />
        <h2 className="font-pixel text-xs uppercase tracking-widest text-gold">Party size</h2>
        <button
          type="button"
          className="pixel-btn ml-auto"
          data-active={partyMode}
          aria-pressed={partyMode}
          onClick={() => setPartyMode(!partyMode)}
        >
          {partyMode ? 'ON' : 'OFF'}
        </button>
      </header>

      <div className="space-y-4 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="people" className="font-pixel text-[10px] uppercase text-dim">
            Feeding
          </label>
          <output
            htmlFor="people"
            className="font-pixel text-2xl text-gold"
            aria-live="polite"
          >
            {people} {people === 1 ? 'PERSON' : 'PEOPLE'}
          </output>
        </div>

        <input
          id="people"
          type="range"
          min={1}
          max={20}
          step={1}
          value={people}
          onChange={(e) => setPeople(Number(e.target.value))}
          className="pixel-slider"
          aria-describedby="party-assumption"
        />

        <div className="flex justify-between font-pixel text-[10px] text-dim">
          <span>1</span>
          <span>10</span>
          <span>20</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-pixel text-[10px] uppercase text-dim">Appetite</span>
          {APPETITES.map((option) => (
            <button
              key={option.value}
              type="button"
              className="pixel-btn"
              data-active={appetite === option.value}
              aria-pressed={appetite === option.value}
              onClick={() => setAppetite(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/*
          The serving assumption is stated where the control is, not tucked in a
          footnote. It is the one number in the app that is not observed and cannot be.
        */}
        <p
          id="party-assumption"
          className="flex items-start gap-2 border-4 border-crt bg-void p-3 font-body text-xs leading-relaxed text-dim"
        >
          <PixelIcon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>
            {preview.assumption.message.toUpperCase()} TARGET:{' '}
            <span className="text-ink">{preview.targetAreaSqIn.toFixed(0)} SQ IN</span>
          </span>
        </p>

        {!partyMode && (
          <p className="font-pixel text-[10px] text-dim">
            TURN ON TO RANK BY TOTAL SPEND TO FEED THE GROUP INSTEAD OF COST PER SQ IN.
            <span className="blink text-gold"> _</span>
          </p>
        )}

        {partyMode && targetAreaSqIn !== null && (
          <p className="font-pixel text-[10px] text-leaf">
            RANKING BY TOTAL SPEND TO REACH {targetAreaSqIn.toFixed(0)} SQ IN.
          </p>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- filters */

function FilterPanel(props: {
  chains: string[];
  setChains: (v: string[]) => void;
  crustClasses: CrustClass[];
  setCrustClasses: (v: CrustClass[]) => void;
  fulfillment: Fulfillment | 'all';
  setFulfillment: (v: Fulfillment | 'all') => void;
  showBundles: boolean;
  setShowBundles: (v: boolean) => void;
  includeDeliveryFee: boolean;
  setIncludeDeliveryFee: (v: boolean) => void;
  comparability: ComparabilityMode;
  setComparability: (v: ComparabilityMode) => void;
  hasDeliveryFeeData: boolean;
}) {
  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <section className="pixel-panel">
      <header className="flex items-center gap-3 border-b-4 border-crt bg-panelLit px-4 py-3">
        <PixelIcon name="coin" size={24} />
        <h2 className="font-pixel text-xs uppercase tracking-widest text-gold">Filters</h2>
      </header>

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-2 font-pixel text-[10px] uppercase text-dim">Chain</legend>
          <div className="flex flex-wrap gap-2">
            {CHAINS.map((chain) => (
              <button
                key={chain.slug}
                type="button"
                className="pixel-btn"
                data-active={props.chains.includes(chain.slug)}
                aria-pressed={props.chains.includes(chain.slug)}
                onClick={() => toggle(props.chains, chain.slug, props.setChains)}
              >
                {chain.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-pixel text-[10px] uppercase text-dim">Crust class</legend>
          <div className="flex flex-wrap gap-2">
            {CRUST_CLASSES.map((crust) => (
              <button
                key={crust.value}
                type="button"
                className="pixel-btn"
                data-active={props.crustClasses.includes(crust.value)}
                aria-pressed={props.crustClasses.includes(crust.value)}
                onClick={() => toggle(props.crustClasses, crust.value, props.setCrustClasses)}
              >
                {crust.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-pixel text-[10px] uppercase text-dim">Pickup</legend>
          <div className="flex flex-wrap gap-2">
            {(['all', 'carryout', 'delivery'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="pixel-btn flex items-center gap-2"
                data-active={props.fulfillment === value}
                aria-pressed={props.fulfillment === value}
                onClick={() => props.setFulfillment(value)}
              >
                {value !== 'all' && <PixelIcon name={value} size={16} />}
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-pixel text-[10px] uppercase text-dim">Options</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pixel-btn flex items-center gap-2"
              data-active={props.showBundles}
              aria-pressed={props.showBundles}
              onClick={() => props.setShowBundles(!props.showBundles)}
            >
              <PixelIcon name="bundle" size={16} />
              BUNDLES
            </button>

            <button
              type="button"
              className="pixel-btn"
              data-active={props.comparability === 'strict'}
              aria-pressed={props.comparability === 'strict'}
              onClick={() =>
                props.setComparability(props.comparability === 'strict' ? 'area' : 'strict')
              }
              title="Only rank deals with an identical size composition against each other"
            >
              LIKE-FOR-LIKE
            </button>

            <button
              type="button"
              className="pixel-btn flex items-center gap-2"
              data-active={props.includeDeliveryFee}
              aria-pressed={props.includeDeliveryFee}
              disabled={!props.hasDeliveryFeeData}
              onClick={() => props.setIncludeDeliveryFee(!props.includeDeliveryFee)}
              title={
                props.hasDeliveryFeeData
                  ? 'Add each chain\'s observed delivery fee to delivery deals'
                  : 'No delivery fee has been observed yet, so this cannot be applied'
              }
            >
              <PixelIcon name="delivery" size={16} />
              + FEE
            </button>
          </div>
          {!props.hasDeliveryFeeData && (
            <p className="mt-2 font-pixel text-[10px] leading-relaxed text-dim">
              NO DELIVERY FEE OBSERVED YET — TOGGLE DISABLED RATHER THAN SHOWING A GUESS.
            </p>
          )}
        </fieldset>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- unranked */

function UnrankedPanel({
  entries,
}: {
  entries: { deal: Deal; metrics: { warnings: { code: string; message: string }[] } }[];
}) {
  return (
    <section className="pixel-panel border-flame">
      <header className="flex items-center gap-3 border-b-4 border-flame bg-panelLit px-4 py-3">
        <PixelIcon name="warning" size={24} />
        <h2 className="font-pixel text-xs uppercase tracking-widest text-flame">
          Cannot be ranked
        </h2>
      </header>
      <p className="border-b-4 border-crt px-4 py-3 font-pixel text-[10px] leading-relaxed text-dim">
        THESE OFFERS ARE REAL BUT HAVE NO COMPARABLE VALUE. SHOWN RATHER THAN HIDDEN, WITH
        THE REASON.
      </p>
      <ul className="divide-y-4 divide-crt">
        {entries.map(({ deal, metrics }) => (
          <li key={deal.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-pixel text-[10px] text-grape">
                {deal.chain.replace('_', ' ').toUpperCase()}
              </span>
              <h3 className="font-pixel text-xs text-ink">{deal.dealName.toUpperCase()}</h3>
            </div>
            {metrics.warnings.map((warning) => (
              <p
                key={warning.code}
                className="flex items-start gap-2 font-body text-[11px] leading-relaxed text-dim"
              >
                <PixelIcon name="warning" size={16} className="mt-0.5 shrink-0" />
                <span>{warning.message}</span>
              </p>
            ))}
            <a
              href={deal.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block font-pixel text-[10px] text-sky underline"
            >
              VIEW SOURCE →
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
