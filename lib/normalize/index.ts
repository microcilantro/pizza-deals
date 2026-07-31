/**
 * The single shared normalization module. Every chain's data is interpreted here and
 * nowhere else — scrapers produce rows, this turns rows into comparable numbers.
 */
export * from './types';
export { areaProfile, areaSqIn, totalPizzaAreaSqIn } from './geometry';
export { formatUsd, resolveGrossPrice, roundCents, type GrossPrice } from './pricing';
export { imputePizzaOnlyPrice, type Imputation } from './bundles';
export {
  canCompare,
  comparabilityKey,
  crustClassOf,
  segmentKey,
  segmentLabel,
  segmentOf,
  trackOf,
} from './comparability';
export { computeDealMetrics } from './metrics';
export {
  rankDeals,
  rankWithinSegment,
  type RankedDeal,
  type RankedSegment,
  type RankingResult,
} from './rank';
export {
  REFERENCE_DIAMETER_IN,
  rankForTarget,
  solveForTarget,
  targetAreaForPizzas,
  type QuantityPlan,
  type QuantityRankedDeal,
  type QuantityRankedSegment,
  type QuantityRankingResult,
} from './quantity';
