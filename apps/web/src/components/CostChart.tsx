import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatUsd } from '../lib/format';
import { type DayRow, pivotCostByDay, seriesColor } from '../lib/series';

interface Props {
  rows: Array<{ day: string; agent: string; costUsd: number }>;
  days: number;
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Stacked daily cost by agent. Colors follow the agent (fixed slots), never its rank. */
export function CostChart({ rows, days }: Props) {
  const { data, series } = pivotCostByDay(rows, days);
  const hasData = data.some((d) => d.total > 0);

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {series.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: seriesColor(s) }} />
            {s}
          </li>
        ))}
      </ul>
      <div className="h-64" role="img" aria-label={`Cost per day by agent over the last ${days} days`}>
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--line-strong)' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickFormatter={(v: number) => formatUsd(v)}
                tick={{ fill: 'var(--muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <Tooltip cursor={{ fill: 'var(--sunken)' }} content={<ChartTooltip series={series} />} />
              {series.map((s, i) => (
                <Bar
                  key={s}
                  dataKey={s}
                  stackId="cost"
                  fill={seriesColor(s)}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center rounded-md border border-dashed border-line-strong text-sm text-muted">
            No spend in this period yet.
          </div>
        )}
      </div>
    </div>
  );
}

function ChartTooltip({
  series,
  active,
  payload,
}: {
  series: string[];
  active?: boolean;
  payload?: Array<{ payload: DayRow }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{dayLabel(row.day)}</div>
      <table>
        <tbody>
          {series.map((s) => (
            <tr key={s}>
              <td className="pr-3 text-muted">
                <span
                  className="mr-1.5 inline-block size-2 rounded-sm"
                  style={{ background: seriesColor(s) }}
                />
                {s}
              </td>
              <td className="num text-right text-ink">{formatUsd(Number(row[s] ?? 0))}</td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="pt-1 pr-3 font-medium text-ink">Total</td>
            <td className="num pt-1 text-right font-medium text-ink">{formatUsd(row.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
