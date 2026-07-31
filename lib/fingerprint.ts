import { createHash } from 'node:crypto';
import type { Deal, PizzaItem } from './normalize/types';

/**
 * Stable identity for a deal, used to upsert scraped rows onto existing ones.
 *
 * Price is deliberately excluded. When a $9.99 deal becomes $10.99 that is the same
 * offer at a new price, and `first_seen` must not reset — the price movement belongs in
 * deal_price_history. Folding price into identity would destroy exactly the history the
 * app is best placed to show.
 *
 * Crust and diameter *are* included: an offer that changes from a 14" to a 13.5" pizza,
 * or from hand-tossed to stuffed, is a different offer even under the same marketing
 * name, and quietly overwriting the old row would hide a downsize.
 */
export function dealFingerprint(
  deal: Pick<Deal, 'chain' | 'dealName' | 'fulfillment' | 'pizzaItems' | 'otherItems'>,
): string {
  const parts = [
    deal.chain,
    normalizeName(deal.dealName),
    deal.fulfillment,
    deal.pizzaItems.map(pizzaSignature).sort().join(','),
    deal.otherItems
      .map((i) => `${i.quantity}x${normalizeName(i.descriptor)}`)
      .sort()
      .join(','),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/**
 * Chains rewrite deal names constantly — casing, punctuation, "$9.99" moving in and out
 * of the title. Normalizing keeps a cosmetic rename from looking like a new deal.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pizzaSignature(item: PizzaItem): string {
  const size =
    item.shape.kind === 'round'
      ? `r${item.shape.diameterIn}`
      : `x${item.shape.lengthIn}x${item.shape.widthIn}`;
  return [
    item.quantity,
    size,
    normalizeName(item.crust.name),
    item.toppingCount ?? 'any',
    item.toppingPolicy,
  ].join(':');
}
