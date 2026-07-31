import { imputePizzaOnlyPrice } from './bundles';
import { segmentKey, segmentOf } from './comparability';
import { totalPizzaAreaSqIn } from './geometry';
import { resolveGrossPrice, roundCents } from './pricing';
import {
  DEFAULT_OPTIONS,
  type Assumption,
  type Deal,
  type DealMetrics,
  type MetricBasis,
  type NormalizationOptions,
  type Segment,
  type Warning,
} from './types';

const UNRANKABLE_SEGMENT: Segment = {
  track: 'pizza',
  crustClass: 'standard',
  fulfillment: 'carryout',
  areaProfile: '',
};

/**
 * The one place cost per square inch is computed. Never duplicate this per chain — the
 * scrapers' job ends at producing rows; interpretation happens here so all three chains
 * are interpreted identically by construction.
 */
export function computeDealMetrics(
  deal: Deal,
  options: Partial<NormalizationOptions> = {},
): DealMetrics {
  const opts: NormalizationOptions = { ...DEFAULT_OPTIONS, ...options };
  const assumptions: Assumption[] = [];
  const warnings: Warning[] = [];

  if (deal.stale) {
    assumptions.push({
      code: 'STALE_DATA',
      message: `Last verified ${deal.lastVerifiedAt.toISOString().slice(0, 10)}; the ${deal.chain} scraper has not confirmed this offer since.`,
    });
  }

  const segment = segmentOf(deal);
  if (segment === null) {
    warnings.push({
      code: deal.pizzaItems.length === 0 ? 'NO_PIZZA_ITEMS' : 'MIXED_CRUST_CLASS',
      message:
        deal.pizzaItems.length === 0
          ? 'Offer contains no pizza, so there is no area to normalize against.'
          : 'Offer spans more than one crust class, so it has no single comparison segment.',
    });
    return unrankable(deal, opts, assumptions, warnings);
  }

  const totalAreaSqIn = totalPizzaAreaSqIn(deal.pizzaItems);
  const gross = resolveGrossPrice(deal, opts);
  assumptions.push(...gross.assumptions);
  warnings.push(...gross.warnings);

  if (!gross.resolved) {
    return unrankable(deal, opts, assumptions, warnings, { totalAreaSqIn, segment });
  }

  let effectivePriceUsd = gross.grossPriceUsd;
  let basis: MetricBasis = 'as_advertised';
  let rankable = true;

  if (deal.kind === 'bundle') {
    const imputation = imputePizzaOnlyPrice(deal, gross.grossPriceUsd, opts);
    assumptions.push(...imputation.assumptions);
    warnings.push(...imputation.warnings);

    if (imputation.applied) {
      effectivePriceUsd = imputation.pizzaOnlyPriceUsd;
      basis = 'imputed_pizza_only';
    }
    // A clamped imputation still produces a number for display, but it rests entirely on
    // the credit assumption, so it does not earn a place in the ranking.
    if (imputation.warnings.some((w) => w.code === 'IMPUTED_PRICE_NONPOSITIVE')) {
      rankable = false;
    }
  }

  const costPerSqIn = effectivePriceUsd / totalAreaSqIn;

  return {
    totalAreaSqIn,
    grossPriceUsd: gross.grossPriceUsd,
    effectivePriceUsd,
    costPerSqIn,
    basis,
    pricingBasis: gross.pricingBasis,
    costPerToppingSlot: costPerToppingSlot(deal, effectivePriceUsd, assumptions),
    segment,
    comparabilityKey: segmentKey(segment, opts.comparability),
    assumptions,
    warnings,
    rankable,
  };
}

/**
 * Secondary metric. Stays secondary because topping counting is not consistent across
 * chains — some count a premium meat as two slots — so this ranks within a chain far
 * better than across chains.
 */
function costPerToppingSlot(
  deal: Deal,
  effectivePriceUsd: number,
  assumptions: Assumption[],
): number | null {
  let slots = 0;
  let sawUpTo = false;

  for (const item of deal.pizzaItems) {
    // "Any toppings you want" has no denominator. Return null rather than divide by a guess.
    if (item.toppingPolicy === 'unlimited' || item.toppingCount === null) return null;
    if (item.toppingPolicy === 'up_to') sawUpTo = true;
    slots += item.toppingCount * item.quantity;
  }

  if (slots <= 0) return null;

  if (sawUpTo) {
    assumptions.push({
      code: 'TOPPING_COUNT_IS_MAXIMUM',
      message:
        'Cost per topping assumes the maximum allowed toppings are used; the offer ' +
        'states a ceiling, not a fixed count.',
    });
  }

  return effectivePriceUsd / slots;
}

function unrankable(
  deal: Deal,
  opts: NormalizationOptions,
  assumptions: Assumption[],
  warnings: Warning[],
  known?: { totalAreaSqIn: number; segment: Segment },
): DealMetrics {
  const segment = known?.segment ?? UNRANKABLE_SEGMENT;
  return {
    totalAreaSqIn: known?.totalAreaSqIn ?? 0,
    grossPriceUsd: roundCents(deal.priceUsd ?? 0),
    effectivePriceUsd: roundCents(deal.priceUsd ?? 0),
    costPerSqIn: Number.NaN,
    basis: 'as_advertised',
    pricingBasis: deal.priceUsd !== null ? 'advertised' : 'derived_from_discount',
    costPerToppingSlot: null,
    segment,
    comparabilityKey: known ? segmentKey(segment, opts.comparability) : '',
    assumptions,
    warnings,
    rankable: false,
  };
}
