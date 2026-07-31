import { areaProfile } from './geometry';
import type { ComparabilityMode, CrustClass, Deal, Segment, Track } from './types';

/**
 * Requirement 3: two deals are only directly comparable when diameter and crust match.
 *
 * D3 relaxes the diameter half of that for the headline list — a two-medium deal and a
 * single-large deal are both ranked on cost per in², with the size mix shown per row —
 * while `strict` mode restores exact size matching as a filter. The crust half is never
 * relaxed: specialty crusts carry a premium unrelated to value, so they are segmented,
 * never ranked against hand-tossed.
 */

/** Requirement 4: bundles get their own track, never averaged into the pizza ranking. */
export function trackOf(deal: Deal): Track {
  return deal.kind === 'bundle' ? 'bundle' : 'pizza';
}

/**
 * A deal where the customer picks crust per pizza can span classes, leaving no single
 * class to segment on. Returning null makes that unrankable rather than picking one.
 */
export function crustClassOf(deal: Deal): CrustClass | null {
  if (deal.pizzaItems.length === 0) return null;
  const classes = new Set(deal.pizzaItems.map((i) => i.crust.class));
  if (classes.size > 1) return null;
  return [...classes][0] ?? null;
}

export function segmentOf(deal: Deal): Segment | null {
  const crustClass = crustClassOf(deal);
  if (crustClass === null) return null;
  return {
    track: trackOf(deal),
    crustClass,
    fulfillment: deal.fulfillment,
    areaProfile: areaProfile(deal.pizzaItems),
  };
}

export function segmentKey(segment: Segment, mode: ComparabilityMode): string {
  const base = `${segment.track}|${segment.crustClass}|${segment.fulfillment}`;
  return mode === 'strict' ? `${base}|${segment.areaProfile}` : base;
}

export function comparabilityKey(deal: Deal, mode: ComparabilityMode = 'area'): string | null {
  const segment = segmentOf(deal);
  return segment === null ? null : segmentKey(segment, mode);
}

export function canCompare(a: Deal, b: Deal, mode: ComparabilityMode = 'area'): boolean {
  const keyA = comparabilityKey(a, mode);
  const keyB = comparabilityKey(b, mode);
  return keyA !== null && keyA === keyB;
}

/** Human-readable segment label for UI headings. */
export function segmentLabel(segment: Segment): string {
  const crust = {
    standard: 'Standard crust',
    thin: 'Thin crust',
    specialty: 'Specialty crust',
  }[segment.crustClass];
  const track = segment.track === 'bundle' ? 'bundles' : 'pizza only';
  const fulfillment = segment.fulfillment === 'carryout' ? 'carryout' : 'delivery';
  return `${crust}, ${fulfillment}, ${track}`;
}
