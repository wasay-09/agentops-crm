import type { ReactNode } from 'react';
import { useState } from 'react';
import { useUsage } from '../api/hooks';
import { BudgetMeter } from '../components/BudgetMeter';
import { CostChart } from '../components/CostChart';
import { Card, ErrorNote, Loading, PageHeader, Table, Tabs } from '../components/ui';
import {
  formatCompact,
  formatInt,
  formatMs,
  formatPct,
  formatUsd,
  humanize,
  shortModel,
} from '../lib/format';
import { seriesColor, seriesKey } from '../lib/series';

type Range = '7' | '30';

export function DashboardPage() {
  const [range, setRange] = useState<Range>('7');
  const days = Number(range);
  const usage = useUsage(days);

  return (
    <>
      <PageHeader
        title="Ops dashboard"
        subtitle="What the team’s agents cost, how fast they answer and how often they fail."
        actions={
          <Tabs<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        }
      />
      {usage.isLoading ? (
        <Loading />
      ) : usage.isError || !usage.data ? (
        <ErrorNote error={usage.error ?? 'No data'} />
      ) : (
        <Body u={usage.data} days={days} />
      )}
    </>
  );
}

function Body({ u, days }: { u: import('@agentops/contracts').UsageSummary; days: number }) {
  const totalReasons = u.routingReasons.reduce((s, r) => s + r.calls, 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Spend" value={formatUsd(u.totals.costUsd)} hint={`${u.team.name} · ${days} days`} />
        <Kpi
          label="Model calls"
          value={formatInt(u.totals.calls)}
          hint={`${formatCompact(u.totals.inputTokens + u.totals.outputTokens)} tokens`}
        />
        <Kpi
          label="Agent runs"
          value={formatInt(u.totals.runs)}
          hint={u.totals.runs ? `${formatUsd(u.totals.costUsd / u.totals.runs)} per run` : undefined}
        />
        <Kpi label="p95 latency" value={formatMs(u.totals.p95LatencyMs)} hint="per model call" />
        <Kpi
          label="Error rate"
          value={formatPct(u.totals.errorRate)}
          hint="failed model calls"
          tone={u.totals.errorRate > 0.05 ? 'bad' : undefined}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Cost per day by agent">
          <CostChart rows={u.costByDayAgent} days={days} />
        </Card>
        <div className="space-y-5">
          <Card title="Monthly budget">
            <BudgetMeter budget={u.budget} />
          </Card>
          <Card title="Why each model was chosen">
            {totalReasons === 0 ? (
              <p className="text-sm text-muted">No model calls yet.</p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {u.routingReasons.map((r) => (
                  <li key={r.reason}>
                    <div className="flex justify-between">
                      <span>{humanize(r.reason)}</span>
                      <span className="num text-muted">
                        {formatInt(r.calls)} · {formatPct(r.calls / totalReasons, 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-sunken">
                      <div
                        className={
                          r.reason === 'primary'
                            ? 'h-full rounded-full bg-accent'
                            : 'h-full rounded-full bg-pending'
                        }
                        style={{ width: `${(r.calls / totalReasons) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title="By agent" flush>
        <Table head={['Agent', 'Calls', 'Cost', 'p95 latency', 'Error rate']}>
          {u.byAgent.map((a) => (
            <tr key={a.agent}>
              <td>
                <span
                  className="mr-2 inline-block size-2.5 rounded-sm align-middle"
                  style={{ background: seriesColor(seriesKey(a.agent)) }}
                />
                {a.agent}
              </td>
              <td className="num">{formatInt(a.calls)}</td>
              <td className="num">{formatUsd(a.costUsd)}</td>
              <td className="num">{formatMs(a.p95LatencyMs)}</td>
              <td className={a.errorRate > 0.05 ? 'num text-bad' : 'num'}>{formatPct(a.errorRate)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="By model" flush>
          <Table head={['Model', 'Calls', 'Cost', 'p95', 'Errors']}>
            {u.byModel.map((m) => (
              <tr key={m.model}>
                <td className="font-mono text-xs">{shortModel(m.model)}</td>
                <td className="num">{formatInt(m.calls)}</td>
                <td className="num">{formatUsd(m.costUsd)}</td>
                <td className="num">{formatMs(m.p95LatencyMs)}</td>
                <td className={m.errorRate > 0.05 ? 'num text-bad' : 'num'}>{formatPct(m.errorRate)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="By prompt version" flush>
          <Table head={['Prompt', 'Version', 'Runs', 'Avg cost', 'Avg latency']}>
            {u.byPromptVersion.map((p) => (
              <tr key={`${p.prompt}-${p.version}`}>
                <td>{p.prompt}</td>
                <td className="num">v{p.version}</td>
                <td className="num">{formatInt(p.runs)}</td>
                <td className="num">{formatUsd(p.avgCostUsd)}</td>
                <td className="num">{formatMs(p.avgLatencyMs)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'bad';
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={tone === 'bad' ? 'num mt-1 text-[22px] text-bad' : 'num mt-1 text-[22px] text-ink'}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-faint">{hint}</div>}
    </div>
  );
}
