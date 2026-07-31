import { describe, expect, it } from 'vitest';
import { formatUsd, roundCents } from './pricing';

describe('roundCents', () => {
  it('rounds exact half-cents up rather than down', () => {
    // 50% off $16.99 is $8.495. Binary floating point puts `8.495 * 100` at
    // 849.4999999999999, so a naive Math.round drops a cent here.
    expect(roundCents(16.99 * 0.5)).toBe(8.5);
    expect(roundCents(8.495)).toBe(8.5);
    expect(roundCents(0.005)).toBe(0.01);
  });

  it('leaves already-exact cent values alone', () => {
    expect(roundCents(9.99)).toBe(9.99);
    expect(roundCents(19.99 - 10.48)).toBe(9.51);
    expect(roundCents(0)).toBe(0);
  });

  it('rounds below the half boundary down', () => {
    expect(roundCents(8.494)).toBe(8.49);
    expect(roundCents(0.004)).toBe(0);
  });

  it('survives the discount percentages chains actually advertise', () => {
    expect(roundCents(21.99 * 0.75)).toBe(16.49);
    expect(roundCents(13.99 * 0.65)).toBe(9.09);
    expect(roundCents(12.49 * 0.5)).toBe(6.25);
  });
});

describe('formatUsd', () => {
  it('always shows two decimal places', () => {
    expect(formatUsd(9.9)).toBe('$9.90');
    expect(formatUsd(10)).toBe('$10.00');
    expect(formatUsd(8.495)).toBe('$8.50');
  });
});
