import { describe, expect, it } from 'vitest';
import { formatMs, formatPct, formatRelative, formatUsd, humanize, shortModel } from './format';

describe('formatUsd', () => {
  it('shows sub-cent amounts with four decimals', () => {
    expect(formatUsd(0.00421)).toBe('$0.0042');
  });
  it('shows cents and dollars sensibly', () => {
    expect(formatUsd(0.25)).toBe('$0.25');
    expect(formatUsd(0.042)).toBe('$0.042');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(48000)).toBe('$48,000.00');
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('handles non-finite values', () => {
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});

describe('formatMs', () => {
  it('formats milliseconds, seconds and minutes', () => {
    expect(formatMs(812)).toBe('812 ms');
    expect(formatMs(1534)).toBe('1.53 s');
    expect(formatMs(12_300)).toBe('12.3 s');
    expect(formatMs(125_000)).toBe('2m 5s');
    expect(formatMs(null)).toBe('—');
  });
});

describe('misc', () => {
  it('formats ratios as percentages', () => {
    expect(formatPct(0.0425)).toBe('4.3%');
  });
  it('relative time', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(formatRelative('2026-10-07T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-07T11:00:00Z', now)).toBe('1 h ago');
  });
  it('strips provider prefix and humanizes slugs', () => {
    expect(shortModel('anthropic:claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(shortModel('mock:claude-haiku-4-5')).toBe('mock:claude-haiku-4-5');
    expect(humanize('budget_downgrade')).toBe('Budget downgrade');
  });
});
