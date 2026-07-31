import type { Assumption, Deal, DealMetrics, QuantityPlan } from '@/lib/normalize';
import { iconForCategory, PixelIcon } from './PixelIcon';

interface DealCardProps {
  deal: Deal;
  metrics: DealMetrics;
  rank: number;
  /** Present only in party mode. */
  plan?: QuantityPlan;
  peopleFedByOffer: number;
}

const CHAIN_COLOR: Record<string, string> = {
  dominos: 'text-sky',
  pizza_hut: 'text-flame',
  papa_johns: 'text-leaf',
};

/**
 * The serving-size assumption is stated in full on the party panel directly above the
 * list. Repeating that paragraph verbatim on every card produced a wall of identical
 * text, which makes it *less* likely to be read, not more. Cards keep a short form so
 * one lifted out of context still carries the basis for its numbers.
 */
function shorten(assumption: Assumption): string {
  if (assumption.code === 'SERVING_SIZE_ASSUMED') {
    const match = assumption.message.match(/Assumes (\d+) slices? per person/i);
    return match
      ? `Serving size: ${match[1]} slices per person (see Party Size above).`
      : assumption.message;
  }
  return assumption.message;
}

export function DealCard({ deal, metrics, rank, plan, peopleFedByOffer }: DealCardProps) {
  return (
    <article className="space-y-3 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center border-4 border-crt bg-void font-pixel text-xs text-gold"
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>

        {rank === 1 && <PixelIcon name="trophy" size={32} label="Best value in this group" />}

        <div className="min-w-0 flex-1">
          <p className={`font-pixel text-[10px] ${CHAIN_COLOR[deal.chain] ?? 'text-dim'}`}>
            {deal.chain.replace('_', ' ').toUpperCase()}
          </p>
          {/* The offer exactly as advertised, never our paraphrase of it. */}
          <h3 className="font-pixel text-xs leading-relaxed text-ink">
            {deal.dealName.toUpperCase()}
          </h3>
        </div>

        {/*
          The headline number must be the one the list is actually sorted by. In party
          mode that is total spend, so leading with cost per in² would show an apparently
          unsorted column of numbers next to an ordered list.
        */}
        <div className="text-right">
          {plan ? (
            <>
              <p className="font-pixel text-lg text-gold">${plan.totalCostUsd.toFixed(2)}</p>
              <p className="font-pixel text-[10px] text-dim">
                TOTAL · ${metrics.costPerSqIn.toFixed(4)}/SQ IN
              </p>
            </>
          ) : (
            <>
              <p className="font-pixel text-lg text-gold">${metrics.costPerSqIn.toFixed(4)}</p>
              <p className="font-pixel text-[10px] text-dim">PER SQ IN</p>
            </>
          )}
        </div>
      </div>

      {/* What you actually get. */}
      <div className="flex flex-wrap items-center gap-3 border-4 border-crt bg-void p-3">
        {deal.pizzaItems.map((item, i) => (
          <span key={i} className="flex items-center gap-2 font-pixel text-[10px] text-ink">
            <PixelIcon name="pizza" size={24} />
            {item.quantity > 1 && <span className="text-gold">{item.quantity}x</span>}
            <span>
              {item.shape.kind === 'round'
                ? `${item.shape.diameterIn}"`
                : `${item.shape.lengthIn}x${item.shape.widthIn}"`}
            </span>
            <span className="text-dim">{item.crust.name.toUpperCase()}</span>
            {item.toppingCount !== null && (
              <span className="text-dim">
                {item.toppingPolicy === 'up_to' ? '≤' : ''}
                {item.toppingCount} TOP
              </span>
            )}
          </span>
        ))}

        {deal.otherItems.map((item, i) => (
          <span key={i} className="flex items-center gap-2 font-pixel text-[10px] text-dim">
            <PixelIcon name={iconForCategory(item.category)} size={24} />
            {item.quantity > 1 && <span className="text-gold">{item.quantity}x</span>}
            {item.descriptor.toUpperCase()}
          </span>
        ))}

        <span className="ml-auto flex items-center gap-2 font-pixel text-[10px] text-dim">
          <PixelIcon name={deal.fulfillment} size={24} />
          {deal.fulfillment.toUpperCase()}
        </span>
      </div>

      {/* Party mode: the plan to feed the group. */}
      {plan && (
        <div className="border-4 border-gold bg-panelLit p-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-pixel text-xs text-gold">
              BUY {plan.units} → ${plan.totalCostUsd.toFixed(2)}
            </span>
            <span className="font-pixel text-[10px] text-dim">
              {plan.totalAreaSqIn.toFixed(0)} SQ IN
            </span>
            <span className="font-pixel text-[10px] text-dim">
              ${plan.effectiveCostPerWantedSqIn.toFixed(4)} PER SQ IN YOU WANTED
            </span>
            {plan.overshootSqIn > 0 && (
              <span className="font-pixel text-[10px] text-crust">
                +{(plan.overshootPct * 100).toFixed(0)}% LEFTOVER
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-pixel text-[10px] text-dim">
        <span className="flex items-center gap-1 text-ink">
          <PixelIcon name="coin" size={16} />${metrics.effectivePriceUsd.toFixed(2)}
          {metrics.basis === 'imputed_pizza_only' && <span className="text-crust"> PIZZA ONLY</span>}
        </span>
        <span>{metrics.totalAreaSqIn.toFixed(0)} SQ IN</span>
        <span>FEEDS ~{peopleFedByOffer.toFixed(1)}</span>
        {metrics.costPerToppingSlot !== null && (
          <span>${metrics.costPerToppingSlot.toFixed(2)}/TOPPING</span>
        )}
        {deal.promoCode && (
          <span className="border-2 border-gold px-2 py-0.5 text-gold">
            CODE: {deal.promoCode}
          </span>
        )}
      </div>

      {/*
        Assumptions are rendered on the card, not behind a tooltip. A number produced by
        crediting $10.48 of sides is a different claim from an advertised price, and the
        card has to say so where the number is.
      */}
      {(metrics.assumptions.length > 0 || (plan?.assumptions.length ?? 0) > 0) && (
        <ul className="space-y-1">
          {[...metrics.assumptions, ...(plan?.assumptions ?? [])].map((assumption, i) => (
            <li
              key={`${assumption.code}-${i}`}
              className="flex items-start gap-2 font-body text-[11px] leading-relaxed text-dim"
            >
              <PixelIcon
                name={assumption.code === 'STALE_DATA' ? 'warning' : 'info'}
                size={16}
                className="mt-0.5 shrink-0"
              />
              <span>{shorten(assumption)}</span>
            </li>
          ))}
        </ul>
      )}

      {metrics.warnings.length > 0 && (
        <ul className="space-y-1">
          {metrics.warnings.map((warning) => (
            <li
              key={warning.code}
              className="flex items-start gap-2 font-body text-[11px] leading-relaxed text-flame"
            >
              <PixelIcon name="warning" size={16} className="mt-0.5 shrink-0" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={deal.sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-block font-pixel text-[10px] text-sky underline"
      >
        VIEW SOURCE →
      </a>
    </article>
  );
}
