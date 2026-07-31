import { segmentLabel } from './comparability';
import { computeDealMetrics } from './metrics';
import { roundCents } from './pricing';
import {
  DEFAULT_OPTIONS,
  type Assumption,
  type Deal,
  type DealMetrics,
  type NormalizationOptions,
  type Segment,
} from './types';

/**
 * "How much pizza do I actually need?" ranking.
 *
 * Worth being clear about why this is not just the main ranking with a multiplier:
 * cost per square inch is scale-invariant. Doubling every deal changes no ordering at
 * all. What makes quantity interesting is that you have to buy *whole* offers — so a
 * deal with the best ratio can still lose on total spend because hitting your target
 * takes four of them and overshoots badly, while a larger offer lands closer and costs
 * less overall.
 *
 * Everything here works in area, never in pizza counts. "Three pizzas" is meaningless
 * across a 14" and a 12"; that is the whole premise of the app.
 */

/** A 14" round pizza, used only to label the slider in units people can picture. */
export const REFERENCE_DIAMETER_IN = 14;

export function targetAreaForPizzas(
  pizzas: number,
  referenceDiameterIn: number = REFERENCE_DIAMETER_IN,
): number {
  if (!(pizzas > 0)) throw new RangeError(`pizzas must be positive, got ${pizzas}`);
  const r = referenceDiameterIn / 2;
  return pizzas * Math.PI * r * r;
}

export interface QuantityPlan {
  /** How many of this offer you buy to reach the target. */
  units: number;
  totalCostUsd: number;
  totalAreaSqIn: number;
  targetAreaSqIn: number;
  /** Area beyond what you asked for. You pay for it either way. */
  overshootSqIn: number;
  overshootPct: number;
  /**
   * Total spend divided by the area you actually wanted, counting overshoot as waste.
   * Unlike cost per in², this does change with quantity — it is the number the slider
   * exists to reveal.
   */
  effectiveCostPerWantedSqIn: number;
  assumptions: Assumption[];
}

export function solveForTarget(
  metrics: DealMetrics,
  targetAreaSqIn: number,
): QuantityPlan {
  if (!(targetAreaSqIn > 0)) {
    throw new RangeError(`targetAreaSqIn must be positive, got ${targetAreaSqIn}`);
  }

  // Nudge before rounding up: asking for exactly three 14" pizzas gives a ratio of
  // 3.0000000000000004 in binary floating point, and a naive ceil would sell a fourth.
  const ratio = targetAreaSqIn / metrics.totalAreaSqIn;
  const units = Math.max(1, Math.ceil(ratio - 1e-9));
  const totalCostUsd = roundCents(metrics.effectivePriceUsd * units);
  const totalAreaSqIn = metrics.totalAreaSqIn * units;
  const overshootSqIn = totalAreaSqIn - targetAreaSqIn;

  const assumptions: Assumption[] = [];
  if (units > 1) {
    assumptions.push({
      code: 'REPEAT_PURCHASE',
      message:
        `Assumes you can buy this offer ${units} times in one order. Per-order coupon ` +
        'limits are not published on the deal pages and are not modeled, so the real ' +
        'total may be higher.',
    });
  }
  if (overshootSqIn > 0) {
    assumptions.push({
      code: 'TARGET_OVERSHOT',
      message:
        `Buying whole offers overshoots your target by ${overshootSqIn.toFixed(0)} in² ` +
        `(${((overshootSqIn / targetAreaSqIn) * 100).toFixed(0)}% more pizza than asked for).`,
    });
  }

  return {
    units,
    totalCostUsd,
    totalAreaSqIn,
    targetAreaSqIn,
    overshootSqIn,
    overshootPct: overshootSqIn / targetAreaSqIn,
    effectiveCostPerWantedSqIn: totalCostUsd / targetAreaSqIn,
    assumptions,
  };
}

export interface QuantityRankedDeal {
  deal: Deal;
  metrics: DealMetrics;
  plan: QuantityPlan;
  rank: number;
}

export interface QuantityRankedSegment {
  key: string;
  segment: Segment;
  label: string;
  deals: QuantityRankedDeal[];
}

export interface QuantityRankingResult {
  targetAreaSqIn: number;
  segments: QuantityRankedSegment[];
  ungrouped: { deal: Deal; metrics: DealMetrics }[];
}

/**
 * Ranks by total spend to reach the target, not by cost per square inch.
 *
 * Segmentation is unchanged — crust class, fulfillment, and the bundle/pizza split still
 * hold, because needing more pizza is not a reason to start comparing stuffed crust
 * against hand-tossed.
 */
export function rankForTarget(
  deals: readonly Deal[],
  targetAreaSqIn: number,
  options: Partial<NormalizationOptions> = {},
): QuantityRankingResult {
  const opts: NormalizationOptions = { ...DEFAULT_OPTIONS, ...options };
  const bySegment = new Map<string, { segment: Segment; entries: QuantityRankedDeal[] }>();
  const ungrouped: QuantityRankingResult['ungrouped'] = [];

  for (const deal of deals) {
    const metrics = computeDealMetrics(deal, opts);
    if (!metrics.rankable || !Number.isFinite(metrics.costPerSqIn)) {
      ungrouped.push({ deal, metrics });
      continue;
    }

    const plan = solveForTarget(metrics, targetAreaSqIn);
    const entry: QuantityRankedDeal = { deal, metrics, plan, rank: 0 };

    const existing = bySegment.get(metrics.comparabilityKey);
    if (existing) existing.entries.push(entry);
    else bySegment.set(metrics.comparabilityKey, { segment: metrics.segment, entries: [entry] });
  }

  const segments = [...bySegment.entries()]
    .map(([key, { segment, entries }]) => {
      entries.sort(
        (a, b) =>
          a.plan.totalCostUsd - b.plan.totalCostUsd ||
          // Same spend: prefer the one that wastes less.
          a.plan.overshootSqIn - b.plan.overshootSqIn ||
          a.deal.chain.localeCompare(b.deal.chain) ||
          a.deal.id - b.deal.id,
      );
      entries.forEach((entry, i) => {
        entry.rank = i + 1;
      });
      return { key, segment, label: segmentLabel(segment), deals: entries };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return { targetAreaSqIn, segments, ungrouped };
}
