import { describe, expect, it } from 'vitest';
import { pivotCostByDay, seriesColor, seriesKey } from './series';

describe('series mapping', () => {
  it('keeps known agents and folds others', () => {
    expect(seriesKey('email-drafter')).toBe('email-drafter');
    expect(seriesKey('triage-bot')).toBe('Other');
    expect(seriesColor('crm-assistant')).toBe('var(--series-1)');
    expect(seriesColor('Other')).toBe('var(--series-4)');
  });
});

describe('pivotCostByDay', () => {
  it('fills every day in range and sums per agent', () => {
    const { data, series } = pivotCostByDay(
      [
        { day: '2026-10-07', agent: 'crm-assistant', costUsd: 0.5 },
        { day: '2026-10-07', agent: 'triage-bot', costUsd: 0.25 },
        { day: '2026-10-05', agent: 'crm-assistant', costUsd: 1 },
        { day: '2026-09-01', agent: 'crm-assistant', costUsd: 9 },
      ],
      3,
      new Date('2026-10-07T15:00:00Z'),
    );
    expect(series).toEqual(['crm-assistant', 'Other']);
    expect(data.map((d) => d.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(data[0]).toMatchObject({ 'crm-assistant': 1, total: 1 });
    expect(data[1]).toMatchObject({ total: 0 });
    expect(data[2]).toMatchObject({ 'crm-assistant': 0.5, Other: 0.25, total: 0.75 });
  });
});
