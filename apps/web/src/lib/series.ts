/**
 * Fixed agent → color slot mapping, so an agent keeps its color on every chart and
 * filter. Agents beyond the known three fold into slot 4 ("Other").
 */
export const KNOWN_AGENTS = ['crm-assistant', 'lead-summarizer', 'email-drafter'] as const;
export const OTHER = 'Other';

export function seriesKey(agent: string): string {
  return (KNOWN_AGENTS as readonly string[]).includes(agent) ? agent : OTHER;
}

export function seriesColor(key: string): string {
  const i = (KNOWN_AGENTS as readonly string[]).indexOf(key);
  return `var(--series-${i === -1 ? 4 : i + 1})`;
}

export interface DayRow {
  day: string;
  total: number;
  [series: string]: number | string;
}

/** Pivots [{day, agent, costUsd}] into one row per day, filling missing days with zeros. */
export function pivotCostByDay(
  rows: Array<{ day: string; agent: string; costUsd: number }>,
  days: number,
  today: Date = new Date(),
): { data: DayRow[]; series: string[] } {
  const present = new Set(rows.map((r) => seriesKey(r.agent)));
  const series = [...KNOWN_AGENTS.filter((a) => present.has(a)), ...(present.has(OTHER) ? [OTHER] : [])];
  const byDay = new Map<string, DayRow>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    const row: DayRow = { day: key, total: 0 };
    for (const s of series) row[s] = 0;
    byDay.set(key, row);
  }
  for (const r of rows) {
    const key = r.day.slice(0, 10);
    const row = byDay.get(key);
    if (!row) continue;
    const s = seriesKey(r.agent);
    row[s] = (row[s] as number) + r.costUsd;
    row.total += r.costUsd;
  }
  return { data: [...byDay.values()], series };
}
