import { segmentLabel } from './comparability';
import { computeDealMetrics } from './metrics';
import {
  DEFAULT_OPTIONS,
  type Deal,
  type DealMetrics,
  type NormalizationOptions,
  type Segment,
} from './types';

export interface RankedDeal {
  deal: Deal;
  metrics: DealMetrics;
  /** 1-based position within the deal's own segment. */
  rank: number;
}

export interface RankedSegment {
  key: string;
  segment: Segment;
  label: string;
  deals: RankedDeal[];
}

export interface RankingResult {
  segments: RankedSegment[];
  /** Deals we declined to rank, each carrying the warnings that explain why. */
  ungrouped: { deal: Deal; metrics: DealMetrics }[];
}

/**
 * Ranks deals within comparable segments, lowest cost per square inch first.
 *
 * Nothing is ranked across segments. A specialty crust carries a premium unrelated to
 * value, and a bundle's price rests on an imputation — putting either in the same list
 * as a plain hand-tossed carryout deal would produce a ranking that looks authoritative
 * and means nothing.
 */
export function rankDeals(
  deals: readonly Deal[],
  options: Partial<NormalizationOptions> = {},
): RankingResult {
  const opts: NormalizationOptions = { ...DEFAULT_OPTIONS, ...options };
  const bySegment = new Map<string, { segment: Segment; entries: RankedDeal[] }>();
  const ungrouped: RankingResult['ungrouped'] = [];

  for (const deal of deals) {
    const metrics = computeDealMetrics(deal, opts);

    if (!metrics.rankable || !Number.isFinite(metrics.costPerSqIn)) {
      ungrouped.push({ deal, metrics });
      continue;
    }

    const existing = bySegment.get(metrics.comparabilityKey);
    if (existing) {
      existing.entries.push({ deal, metrics, rank: 0 });
    } else {
      bySegment.set(metrics.comparabilityKey, {
        segment: metrics.segment,
        entries: [{ deal, metrics, rank: 0 }],
      });
    }
  }

  const segments: RankedSegment[] = [...bySegment.entries()]
    .map(([key, { segment, entries }]) => {
      entries.sort(
        (a, b) =>
          a.metrics.costPerSqIn - b.metrics.costPerSqIn ||
          a.deal.chain.localeCompare(b.deal.chain) ||
          a.deal.id - b.deal.id,
      );
      entries.forEach((entry, i) => {
        entry.rank = i + 1;
      });
      return { key, segment, label: segmentLabel(segment), deals: entries };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return { segments, ungrouped };
}

/** Flattened best-value-first view within one segment, for the default list page. */
export function rankWithinSegment(
  deals: readonly Deal[],
  segmentKeyWanted: string,
  options: Partial<NormalizationOptions> = {},
): RankedDeal[] {
  const { segments } = rankDeals(deals, options);
  return segments.find((s) => s.key === segmentKeyWanted)?.deals ?? [];
}
