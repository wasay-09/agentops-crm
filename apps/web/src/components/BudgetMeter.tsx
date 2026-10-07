import type { UsageSummary } from '@agentops/contracts';
import { formatPct, formatUsd } from '../lib/format';
import { StatusBadge } from './StatusBadge';
import { cx } from './ui';

const FILL: Record<UsageSummary['budget']['state'], string> = {
  ok: 'bg-accent',
  soft: 'bg-pending',
  hard: 'bg-bad',
};

const EXPLAIN: Record<UsageSummary['budget']['state'], string> = {
  ok: 'Requests use each task’s normal model.',
  soft: 'Past the soft limit: the gateway now routes to cheaper models.',
  hard: 'Budget used up: new AI requests are refused until it is raised.',
};

/** Month-to-date spend against the team budget, with the soft-limit (downgrade) marker. */
export function BudgetMeter({ budget }: { budget: UsageSummary['budget'] }) {
  const limit = budget.monthlyLimitUsd;
  const used = limit > 0 ? budget.monthToDateUsd / limit : 0;
  const pct = Math.min(used, 1) * 100;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="num text-2xl font-medium">{formatUsd(budget.monthToDateUsd)}</span>
          <span className="ml-1.5 text-sm text-muted">of {formatUsd(limit)} this month</span>
        </div>
        <StatusBadge status={budget.state} label={budget.state === 'ok' ? 'Within budget' : undefined} />
      </div>
      <meter className="sr-only" min={0} max={100} value={Math.round(used * 100)}>
        {formatPct(used, 0)} of monthly budget used
      </meter>
      <div aria-hidden className="relative mt-3 h-2.5 rounded-full bg-sunken">
        <div className={cx('h-full rounded-full', FILL[budget.state])} style={{ width: `${pct}%` }} />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-ink/60"
          style={{ left: `${budget.softLimitPct}%` }}
          title={`Soft limit ${budget.softLimitPct}%`}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{used > 0 && used < 0.01 ? '<1%' : formatPct(used, 0)} used</span>
        <span>soft limit at {budget.softLimitPct}%</span>
      </div>
      <p className="mt-2 text-xs text-muted">{EXPLAIN[budget.state]}</p>
    </div>
  );
}
