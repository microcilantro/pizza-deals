import type { CrustClass, DealKind, ToppingPolicy } from '@/lib/normalize/types';
import type { RawDealCard, ScrapedDeal, ScrapedPizzaItem } from '../types';

/**
 * Pure parsing of Domino's advertised offer text into structured rows.
 *
 * This module never touches a DOM or a network. That is deliberate and it is the whole
 * point of the split: the selectors that produce `RawDealCard` cannot be verified
 * without the live site, but the strings they carry ("$7.99 Large 3-Topping Pizza",
 * "Mix & Match 2 or More $6.99 each") are the chain's real advertising copy, so
 * everything here is testable today and the tests stay meaningful when selectors change.
 *
 * The rule throughout: when a field cannot be read confidently, record a note and leave
 * the field null. Downstream the deal becomes unrankable and says why. Never guess.
 */

export interface ParseOutcome {
  deal: ScrapedDeal | null;
  /** Populated when the card could not be turned into a deal at all. */
  unparsed: { raw: string; reason: string } | null;
}

/** Domino's crust names, mapped to our three classes. */
const CRUST_CLASSES: { pattern: RegExp; name: string; crustClass: CrustClass }[] = [
  { pattern: /hand[\s-]?tossed/i, name: 'Hand Tossed', crustClass: 'standard' },
  { pattern: /crunchy thin|thin crust/i, name: 'Crunchy Thin', crustClass: 'thin' },
  { pattern: /brooklyn/i, name: 'Brooklyn Style', crustClass: 'specialty' },
  { pattern: /handmade pan|pan pizza/i, name: 'Handmade Pan', crustClass: 'specialty' },
  { pattern: /gluten[\s-]?free/i, name: 'Gluten Free', crustClass: 'specialty' },
];

const SIZE_LABELS = ['X-Large', 'XL', 'Large', 'Medium', 'Small', 'Personal'];

export function parsePriceUsd(text: string | null | undefined): number | null {
  if (!text) return null;
  // Take the first money-looking token; "2 or more $6.99 each" must yield 6.99, not 2.
  const match = text.match(/\$\s?(\d{1,3}(?:\.\d{1,2})?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseDiscountPercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d{1,3})\s?%\s*(?:off|discount)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value < 100 ? value : null;
}

export function parseSizeLabel(text: string): string | null {
  for (const label of SIZE_LABELS) {
    const pattern = new RegExp(`\\b${label.replace('-', '[\\s-]?')}\\b`, 'i');
    if (pattern.test(text)) return label === 'XL' ? 'X-Large' : label;
  }
  return null;
}

export function parseCrust(text: string): { name: string; crustClass: CrustClass } | null {
  for (const crust of CRUST_CLASSES) {
    if (crust.pattern.test(text)) return { name: crust.name, crustClass: crust.crustClass };
  }
  return null;
}

export interface ToppingSpec {
  count: number | null;
  policy: ToppingPolicy;
}

export function parseToppings(text: string): ToppingSpec {
  // "Any Toppings" / "all the toppings" — no denominator exists.
  if (/\bany toppings?\b|\ball toppings?\b|\bunlimited toppings?\b/i.test(text)) {
    // "any toppings up to 7" is a ceiling, not unlimited — check that first.
    const capped = text.match(/up to (\d{1,2})\s*toppings?/i);
    if (capped) return { count: Number(capped[1]), policy: 'up_to' };
    return { count: null, policy: 'unlimited' };
  }

  const upTo = text.match(/up to (\d{1,2})\s*toppings?/i);
  if (upTo) return { count: Number(upTo[1]), policy: 'up_to' };

  const exact = text.match(/(\d{1,2})[\s-]?toppings?/i);
  if (exact) return { count: Number(exact[1]), policy: 'exact' };

  if (/\bcheese\b/i.test(text)) return { count: 0, policy: 'exact' };

  return { count: null, policy: 'exact' };
}

export function parseFulfillment(...texts: (string | null | undefined)[]): 'carryout' | 'delivery' | null {
  const joined = texts.filter(Boolean).join(' ');
  // Check carryout first: "carryout only" is more specific than an incidental "delivery".
  if (/carry[\s-]?out|pick[\s-]?up|takeaway/i.test(joined)) return 'carryout';
  if (/delivery|delivered/i.test(joined)) return 'delivery';
  return null;
}

/** "2 or more", "buy 2", "two medium" → quantity. */
export function parseQuantity(text: string): number {
  const digits = text.match(/(?:buy\s*)?(\d{1,2})\s*(?:or more|\+)?\s*(?:medium|large|small|pizzas?|items?)/i);
  if (digits) {
    const n = Number(digits[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const words: Record<string, number> = { two: 2, three: 3, four: 4 };
  const word = text.match(/\b(two|three|four)\b/i);
  if (word) return words[word[1]!.toLowerCase()] ?? 1;
  return 1;
}

export function parsePromoCode(text: string | null | undefined): string | null {
  if (!text) return null;
  // The keyword matches in any case ("Promo:", "code"), but the code itself must be
  // upper-case or digits — otherwise "use code at checkout" captures "checkout".
  const match = text.match(/\b(?:code|promo|coupon)\s*:?\s*([A-Za-z0-9]{3,12})\b/i);
  if (!match) return null;
  const token = match[1]!;
  return token === token.toUpperCase() ? token : null;
}

/** Non-pizza items mentioned in a bundle description. */
const SIDE_PATTERNS: { pattern: RegExp; category: string; descriptor: string }[] = [
  { pattern: /stuffed cheesy bread/i, category: 'breadsticks', descriptor: 'Stuffed Cheesy Bread' },
  { pattern: /bread\s?(?:sticks?|twists?)/i, category: 'breadsticks', descriptor: 'Bread Twists' },
  { pattern: /(\d{1,2})[\s-]?(?:pc|piece)?\s*wings?/i, category: 'wings', descriptor: 'Wings' },
  { pattern: /2[\s-]?liter|2l\b/i, category: 'drink', descriptor: '2-Liter Soda' },
  { pattern: /lava cake|marbled cookie|dessert/i, category: 'dessert', descriptor: 'Dessert' },
  { pattern: /pasta|chicken alfredo/i, category: 'pasta', descriptor: 'Pasta' },
  { pattern: /sandwich/i, category: 'sandwich', descriptor: 'Sandwich' },
  { pattern: /salad/i, category: 'salad', descriptor: 'Salad' },
];

export function parseSides(text: string): { quantity: number; category: string; descriptor: string }[] {
  const found: { quantity: number; category: string; descriptor: string }[] = [];
  for (const side of SIDE_PATTERNS) {
    const match = text.match(side.pattern);
    if (!match) continue;
    const quantity = side.category === 'wings' && match[1] ? 1 : 1;
    const descriptor =
      side.category === 'wings' && match[1] ? `Wings, ${match[1]} pc` : side.descriptor;
    if (!found.some((f) => f.descriptor === descriptor)) {
      found.push({ quantity, category: side.category, descriptor });
    }
  }
  return found;
}

export function parseValidThrough(text: string | null | undefined): string | null {
  if (!text) return null;
  // "through August 3, 2026" / "expires 8/3/2026" / "ends 2026-08-03"
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slash) {
    const [, m, d, y] = slash;
    const year = y!.length === 2 ? `20${y}` : y!;
    return `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }

  const MONTHS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const named = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(\d{4}))?/i,
  );
  if (named) {
    const monthIndex = MONTHS.indexOf(named[1]!.toLowerCase()) + 1;
    const day = named[2]!.padStart(2, '0');
    const year = named[3] ?? String(new Date().getUTCFullYear());
    return `${year}-${String(monthIndex).padStart(2, '0')}-${day}`;
  }
  return null;
}

/**
 * Turns one scraped card into a deal, or explains why it could not.
 *
 * A card is rejected rather than half-built when it has no price *and* no discount, or
 * when it contains no pizza — those cannot produce a comparable value, and inventing a
 * plausible row would be worse than dropping it loudly.
 */
export function parseDealCard(card: RawDealCard): ParseOutcome {
  const notes: string[] = [];
  const haystack = `${card.title} ${card.description}`;
  const raw = `${card.title} | ${card.description} | ${card.priceText ?? ''}`;

  const priceUsd = parsePriceUsd(card.priceText) ?? parsePriceUsd(card.title);
  const discountPercent = parseDiscountPercent(haystack);

  if (priceUsd === null && discountPercent === null) {
    return {
      deal: null,
      unparsed: { raw, reason: 'No price or percentage discount could be read from the offer.' },
    };
  }

  const sizeLabel = parseSizeLabel(haystack);
  const looksLikePizza = /pizza|topping|crust/i.test(haystack) || sizeLabel !== null;
  if (!looksLikePizza) {
    return {
      deal: null,
      unparsed: { raw, reason: 'Offer does not appear to contain a pizza.' },
    };
  }

  if (sizeLabel === null) {
    return {
      deal: null,
      unparsed: {
        raw,
        reason: 'No size label found, so the diameter cannot be resolved from the menu.',
      },
    };
  }

  const crust = parseCrust(haystack);
  if (!crust) {
    // Domino's defaults to Hand Tossed when a deal names no crust. Recorded, not silent.
    notes.push('No crust named in the offer; assumed Hand Tossed, the default crust.');
  }
  if (/any crust/i.test(haystack)) {
    notes.push(
      'Offer states "any crust", so specialty and thin variants are orderable at the ' +
        'same price. Only the standard variant is modeled — the specialty premium is ' +
        'zero for this offer.',
    );
  }

  const toppings = parseToppings(haystack);
  const quantity = parseQuantity(haystack);
  const sides = parseSides(card.description);
  const fulfillment = parseFulfillment(card.fulfillmentText, haystack);

  if (fulfillment === null) {
    return {
      deal: null,
      unparsed: {
        raw,
        reason:
          'Carryout vs delivery could not be determined, and they are separate rows that ' +
          'must not be merged.',
      },
    };
  }

  const pizzaItem: ScrapedPizzaItem = {
    quantity,
    sizeLabel,
    crustName: crust?.name ?? 'Hand Tossed',
    toppingCount: toppings.count,
    toppingPolicy: toppings.policy,
  };

  const kind: DealKind =
    sides.length > 0 ? 'bundle' : quantity > 1 ? 'multi_pizza' : 'single_pizza';

  // Per-item pricing ("$6.99 each, 2 or more") multiplies out to the modeled bundle.
  const isPerItemPrice = /\beach\b/i.test(haystack) && quantity > 1;
  const totalPrice = priceUsd !== null && isPerItemPrice ? priceUsd * quantity : priceUsd;
  if (isPerItemPrice) {
    notes.push(
      `Advertised per item at $${priceUsd?.toFixed(2)} each with a minimum of ${quantity}; ` +
        `modeled as the ${quantity}-item combination.`,
    );
  }

  return {
    deal: {
      dealName: card.title.trim(),
      kind,
      fulfillment,
      priceUsd: totalPrice,
      discountPercent: totalPrice === null ? discountPercent : null,
      discountScope: totalPrice === null && discountPercent !== null ? 'pizza' : null,
      promoCode: card.promoCode ?? parsePromoCode(haystack),
      validThrough: parseValidThrough(card.validThroughText ?? card.description),
      pizzaItems: [pizzaItem],
      otherItems: sides,
      sourceUrl: card.sourceUrl,
      notes,
    },
    unparsed: null,
  };
}

/**
 * Diameter comes from the menu page, never from a hardcoded table (requirement 1). This
 * reads it out of whatever the size row says: `14"`, `14 inch`, `Large (14")`.
 */
export function parseDiameterIn(text: string): number | null {
  const match = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:"|''|inch(?:es)?|in\b)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 4 && value <= 30 ? value : null;
}

/** Rectangular pizzas exist, so the menu parser must not assume a diameter. */
export function parseRectDimensions(text: string): { lengthIn: number; widthIn: number } | null {
  const match = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:"|inch(?:es)?|in)?\s*[x×]\s*(\d{1,2}(?:\.\d)?)/i);
  if (!match) return null;
  const lengthIn = Number(match[1]);
  const widthIn = Number(match[2]);
  if (![lengthIn, widthIn].every((n) => Number.isFinite(n) && n >= 4 && n <= 30)) return null;
  return { lengthIn, widthIn };
}
