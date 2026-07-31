import type { PizzaItem, Shape } from './types';

/**
 * Area, not diameter, is what people misjudge. A 14" pizza has ~96% more area than a
 * 10", not 40%. Every comparison in this app runs through these two functions.
 */

export function areaSqIn(shape: Shape): number {
  if (shape.kind === 'round') {
    if (!(shape.diameterIn > 0)) {
      throw new RangeError(`diameterIn must be positive, got ${shape.diameterIn}`);
    }
    const r = shape.diameterIn / 2;
    return Math.PI * r * r;
  }

  if (!(shape.lengthIn > 0) || !(shape.widthIn > 0)) {
    throw new RangeError(
      `lengthIn and widthIn must be positive, got ${shape.lengthIn}x${shape.widthIn}`,
    );
  }
  return shape.lengthIn * shape.widthIn;
}

/** Total area across every pizza in the deal, respecting quantity. */
export function totalPizzaAreaSqIn(items: readonly PizzaItem[]): number {
  return items.reduce((sum, item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError(`quantity must be a positive integer, got ${item.quantity}`);
    }
    return sum + areaSqIn(item.shape) * item.quantity;
  }, 0);
}

/**
 * Stable description of a deal's size composition, used to segment strict-mode
 * comparisons. Two 12" pizzas produce a different profile than one 14", which is the
 * distinction requirement 3 is protecting.
 */
export function areaProfile(items: readonly PizzaItem[]): string {
  const areas = items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => areaSqIn(item.shape)),
  );
  const counts = new Map<string, number>();
  for (const a of areas) {
    const key = a.toFixed(2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([area, n]) => (n > 1 ? `${area}x${n}` : area))
    .join('+');
}
