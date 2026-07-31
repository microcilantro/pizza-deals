import { formatUsd, roundCents } from './pricing';
import type { Assumption, Deal, NormalizationOptions, OtherItem, Warning } from './types';

/** Floor for an imputed pizza price, so a runaway credit cannot produce $0.00/in². */
const MIN_IMPUTED_PRICE_USD = 0.01;

export interface Imputation {
  pizzaOnlyPriceUsd: number;
  creditedUsd: number;
  creditedItems: OtherItem[];
  /** Components we could not price. Returned, never silently counted as $0. */
  uncreditedItems: OtherItem[];
  confidence: 'exact' | 'partial' | 'none';
  /** False when the imputation is not usable and the caller should fall back. */
  applied: boolean;
  assumptions: Assumption[];
  warnings: Warning[];
}

/**
 * Requirement 4: a bundle's pizza-only value has to be imputed, and the imputation has
 * to be visible.
 *
 * The $19.99 two-medium bundle is either 36% worse or 35% better than a $9.99 large
 * depending entirely on whether you credit the breadsticks and the 2-liter. That gap is
 * the product. So this returns the credit it applied, the items it used, and the items
 * it could not price — all of which the UI renders alongside the number.
 *
 * D4: components are credited at full à-la-carte menu price by default. That is generous
 * to bundles, but it is the only figure we can source and cite; the alternative is a
 * haircut we invented. `componentCreditFactor` makes it tunable.
 */
export function imputePizzaOnlyPrice(
  deal: Deal,
  grossPriceUsd: number,
  opts: NormalizationOptions,
): Imputation {
  const assumptions: Assumption[] = [];
  const warnings: Warning[] = [];

  const creditedItems = deal.otherItems.filter((i) => i.menuPriceUsd !== null);
  const uncreditedItems = deal.otherItems.filter((i) => i.menuPriceUsd === null);

  const confidence: Imputation['confidence'] =
    deal.otherItems.length === 0 || creditedItems.length === 0
      ? 'none'
      : uncreditedItems.length === 0
        ? 'exact'
        : 'partial';

  const rawCredit = creditedItems.reduce(
    (sum, i) => sum + (i.menuPriceUsd ?? 0) * i.quantity * opts.componentCreditFactor,
    0,
  );

  // Nothing priceable: fall back to the advertised price rather than pretending the
  // sides are free. The UI says so.
  if (confidence === 'none') {
    warnings.push({
      code: 'MISSING_MENU_PRICE',
      message: 'No à-la-carte price found for any bundled component.',
    });
    return {
      pizzaOnlyPriceUsd: grossPriceUsd,
      creditedUsd: 0,
      creditedItems,
      uncreditedItems,
      confidence,
      applied: false,
      assumptions: [
        {
          code: 'BUNDLE_NOT_IMPUTED',
          message:
            'Bundle shown at its full advertised price: no component prices were ' +
            'available, so the pizza-only value could not be separated out.',
        },
      ],
      warnings,
    };
  }

  let pizzaOnly = grossPriceUsd - rawCredit;
  let creditedUsd = rawCredit;

  // Credit exceeding the bundle price means the sides alone list for more than the whole
  // deal. Plausible for a genuinely aggressive bundle, but the resulting cost/in² would
  // sort to the top of every list on the strength of an assumption. Clamp and flag.
  if (pizzaOnly < MIN_IMPUTED_PRICE_USD) {
    warnings.push({
      code: 'IMPUTED_PRICE_NONPOSITIVE',
      message:
        `Component credit (${formatUsd(rawCredit)}) meets or exceeds the bundle price ` +
        `(${formatUsd(grossPriceUsd)}). The pizza-only price is clamped, so this ` +
        'deal is excluded from the ranking.',
    });
    creditedUsd = roundCents(grossPriceUsd - MIN_IMPUTED_PRICE_USD);
    pizzaOnly = MIN_IMPUTED_PRICE_USD;
  }

  const itemList = creditedItems
    .map((i) => `${i.quantity}x ${i.descriptor} @ ${formatUsd(i.menuPriceUsd ?? 0)}`)
    .join(', ');

  assumptions.push({
    code: confidence === 'exact' ? 'BUNDLE_CREDIT' : 'BUNDLE_CREDIT_PARTIAL',
    message:
      `Pizza-only price assumes ${formatUsd(creditedUsd)} of value for the non-pizza ` +
      `items (${itemList})` +
      (opts.componentCreditFactor !== 1
        ? ` at ${Math.round(opts.componentCreditFactor * 100)}% of menu price`
        : ' at full menu price') +
      (uncreditedItems.length > 0
        ? `. Not credited (no menu price found): ${uncreditedItems
            .map((i) => i.descriptor)
            .join(', ')}.`
        : '.'),
  });

  return {
    pizzaOnlyPriceUsd: roundCents(pizzaOnly),
    creditedUsd: roundCents(creditedUsd),
    creditedItems,
    uncreditedItems,
    confidence,
    applied: true,
    assumptions,
    warnings,
  };
}
