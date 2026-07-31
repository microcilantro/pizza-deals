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
  DEFAULT_SERVING_MODEL,
  REFERENCE_DIAMETER_IN,
  SERVING_PRESETS,
  areaPerPersonSqIn,
  areaPerSliceSqIn,
  peopleFed,
  rankForPeople,
  rankForTarget,
  solveForTarget,
  targetAreaForPeople,
  targetAreaForPizzas,
  type QuantityPlan,
  type QuantityRankedDeal,
  type QuantityRankedSegment,
  type QuantityRankingResult,
  type PeopleRankingResult,
  type PeopleTarget,
  type ServingModel,
} from './quantity';
