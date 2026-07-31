/**
 * Data freshness, as pure functions.
 *
 * Pulled out of the component so the rule can be tested directly. This is the logic that
 * was silently wrong when it ran at build time on a static export — a frozen "now" meant
 * the stale indicator could never fire — so it earns its own tests.
 */

/** The scrape job runs at most daily; two days of silence means something is broken. */
export const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export function ageMs(lastVerifiedAt: Date | string, now: number): number {
  const then = typeof lastVerifiedAt === 'string' ? new Date(lastVerifiedAt) : lastVerifiedAt;
  return now - then.getTime();
}

export function ageInDays(lastVerifiedAt: Date | string, now: number): number {
  return Math.floor(ageMs(lastVerifiedAt, now) / 86_400_000);
}

export function isStaleAt(
  lastVerifiedAt: Date | string,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  return ageMs(lastVerifiedAt, now) > staleAfterMs;
}
