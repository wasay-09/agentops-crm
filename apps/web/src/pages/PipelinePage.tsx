import { DEAL_STAGES, type DealStage } from '@agentops/contracts';
import { Link } from 'react-router';
import { type DealRow, useDeals, useUpdateDealStage } from '../api/hooks';
import { ErrorNote, Loading, PageHeader, Select } from '../components/ui';
import { formatRelative, formatUsd, humanize } from '../lib/format';

export function PipelinePage() {
  const deals = useDeals();
  const update = useUpdateDealStage();

  if (deals.isLoading) return <Loading />;
  if (deals.isError) return <ErrorNote error={deals.error} />;

  const byStage = new Map<DealStage, DealRow[]>(DEAL_STAGES.map((s) => [s, []]));
  for (const d of deals.data ?? []) byStage.get(d.stage)?.push(d);
  const open = (deals.data ?? []).filter((d) => d.stage !== 'won' && d.stage !== 'lost');

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={
          <>
            {open.length} open deals worth{' '}
            <span className="num text-ink">{formatUsd(open.reduce((s, d) => s + d.valueUsd, 0))}</span>
          </>
        }
      />
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {DEAL_STAGES.map((stage) => {
          const list = byStage.get(stage) ?? [];
          const total = list.reduce((s, d) => s + d.valueUsd, 0);
          return (
            <section key={stage} className="min-w-0 rounded-lg border border-line bg-sunken/50">
              <header className="flex items-baseline justify-between border-b border-line px-3 py-2">
                <h2 className="text-[13px] font-semibold">
                  {humanize(stage)} <span className="font-normal text-muted">{list.length}</span>
                </h2>
                <span className="num text-xs text-muted">{formatUsd(total)}</span>
              </header>
              <ul className="space-y-2 p-2">
                {list.map((d) => (
                  <li key={d.id} className="rounded-md border border-line bg-surface p-2.5">
                    <div className="text-sm font-medium leading-snug">{d.title}</div>
                    <Link to={`/contacts/${d.contactId}`} className="text-xs text-muted hover:text-accent">
                      {d.contactName}
                    </Link>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="num text-xs">{formatUsd(d.valueUsd)}</span>
                      <Select
                        aria-label={`Move ${d.title}`}
                        value={d.stage}
                        disabled={update.isPending}
                        onChange={(e) => update.mutate({ dealId: d.id, stage: e.target.value as DealStage })}
                        className="h-7 w-28 px-2 text-xs"
                      >
                        {DEAL_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {humanize(s)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="mt-1 text-[11px] text-faint">updated {formatRelative(d.updatedAt)}</div>
                  </li>
                ))}
                {list.length === 0 && <li className="px-1 py-3 text-center text-xs text-faint">No deals</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
