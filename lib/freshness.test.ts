import { describe, expect, it } from 'vitest';
import { STALE_AFTER_MS, ageInDays, isStaleAt } from './freshness';

const CAPTURED = '2026-07-31T00:00:00Z';
const at = (iso: string) => new Date(iso).getTime();

describe('isStaleAt', () => {
  it('is fresh on the day it was captured', () => {
    expect(isStaleAt(CAPTURED, at('2026-07-31T09:00:00Z'))).toBe(false);
  });

  it('is still fresh the next day, since the job runs daily', () => {
    expect(isStaleAt(CAPTURED, at('2026-08-01T12:00:00Z'))).toBe(false);
  });

  it('goes stale after two days of silence', () => {
    expect(isStaleAt(CAPTURED, at('2026-08-02T01:00:00Z'))).toBe(true);
  });

  it('does not flip early at exactly the threshold', () => {
    expect(isStaleAt(CAPTURED, at(CAPTURED) + STALE_AFTER_MS)).toBe(false);
    expect(isStaleAt(CAPTURED, at(CAPTURED) + STALE_AFTER_MS + 1)).toBe(true);
  });

  it('keeps ageing as the page sits unrebuilt — the static-export bug this replaced', () => {
    // A build-time comparison froze here and reported "fresh" indefinitely.
    expect(isStaleAt(CAPTURED, at('2026-09-30T00:00:00Z'))).toBe(true);
    expect(ageInDays(CAPTURED, at('2026-09-30T00:00:00Z'))).toBe(61);
  });

  it('accepts a Date as readily as an ISO string', () => {
    expect(isStaleAt(new Date(CAPTURED), at('2026-08-05T00:00:00Z'))).toBe(true);
  });
});

describe('ageInDays', () => {
  it('counts whole days only', () => {
    expect(ageInDays(CAPTURED, at('2026-07-31T23:59:00Z'))).toBe(0);
    expect(ageInDays(CAPTURED, at('2026-08-01T00:01:00Z'))).toBe(1);
  });
});
