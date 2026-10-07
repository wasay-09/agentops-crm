import { type FormEvent, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { useAgents, useModels, useRouting, useUpdateAgent, useUpdateBudget, useUsage } from '../api/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { Button, Card, ErrorNote, Field, Input, Loading, PageHeader, Table } from '../components/ui';
import { formatUsd, humanize, shortModel } from '../lib/format';

export function AgentsPage() {
  return (
    <>
      <PageHeader
        title="Agents & routing"
        subtitle="Agents, routing and budgets are data. Changes here apply to the next request, no deploy needed."
      />
      <div className="space-y-5">
        <AgentsCard />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <RoutingCard />
          <BudgetCard />
        </div>
        <ModelsCard />
      </div>
    </>
  );
}

function AgentsCard() {
  const agents = useAgents();
  const update = useUpdateAgent();
  return (
    <Card title="Agents" flush>
      {agents.isLoading ? (
        <div className="px-4">
          <Loading />
        </div>
      ) : agents.isError ? (
        <div className="p-4">
          <ErrorNote error={agents.error} />
        </div>
      ) : (
        <Table head={['Agent', 'Task type', 'Prompt', 'Tools', 'Max steps', 'Enabled']}>
          {agents.data?.map((a) => (
            <tr key={a.slug} className="align-top">
              <td>
                <div className="font-medium">{a.name}</div>
                <div className="font-mono text-xs text-muted">{a.slug}</div>
                <div className="mt-0.5 max-w-72 text-xs text-muted">{a.description}</div>
              </td>
              <td>{humanize(a.taskType)}</td>
              <td className="font-mono text-xs">{a.promptName}</td>
              <td>
                <div className="flex max-w-72 flex-wrap gap-1">
                  {a.tools.length === 0 && <span className="text-xs text-faint">none</span>}
                  {a.tools.map((t) => (
                    <span key={t} className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[11px]">
                      {t}
                    </span>
                  ))}
                </div>
              </td>
              <td>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={a.maxSteps}
                  aria-label={`Max steps for ${a.slug}`}
                  className="h-8 w-16 px-2 text-right font-mono"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== a.maxSteps && v >= 1 && v <= 20)
                      update.mutate({ slug: a.slug, patch: { maxSteps: v } });
                  }}
                />
              </td>
              <td>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    disabled={update.isPending}
                    onChange={(e) => update.mutate({ slug: a.slug, patch: { enabled: e.target.checked } })}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="text-xs text-muted">{a.enabled ? 'On' : 'Off'}</span>
                </label>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {update.isError && <p className="px-4 pb-3 text-xs text-bad">{errorMessage(update.error)}</p>}
    </Card>
  );
}

function RoutingCard() {
  const routing = useRouting();
  return (
    <Card title="Routing policies" flush>
      {routing.isLoading ? (
        <div className="px-4">
          <Loading />
        </div>
      ) : routing.isError ? (
        <div className="p-4">
          <ErrorNote error={routing.error} />
        </div>
      ) : (
        <Table head={['Task type', 'Model chain (tried in order)', 'When over soft limit', 'Max output']}>
          {routing.data?.map((p) => (
            <tr key={p.taskType} className="align-top">
              <td className="whitespace-nowrap font-medium">{humanize(p.taskType)}</td>
              <td>
                <ol className="flex flex-wrap items-center gap-1 font-mono text-xs">
                  {p.chain.map((m, i) => (
                    <li key={m} className="flex items-center gap-1">
                      {i > 0 && <span className="text-faint">→</span>}
                      <span
                        className={
                          i === 0
                            ? 'rounded bg-accent-soft px-1.5 py-0.5 text-accent'
                            : 'rounded bg-sunken px-1.5 py-0.5'
                        }
                      >
                        {shortModel(m)}
                      </span>
                    </li>
                  ))}
                </ol>
              </td>
              <td className="font-mono text-xs">{p.budgetModel ? shortModel(p.budgetModel) : '—'}</td>
              <td className="num">{p.maxOutputTokens}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function BudgetCard() {
  const usage = useUsage(7);
  const update = useUpdateBudget();
  const [limit, setLimit] = useState('');
  const [soft, setSoft] = useState('');
  const budget = usage.data?.budget;

  useEffect(() => {
    if (budget) {
      setLimit(String(budget.monthlyLimitUsd));
      setSoft(String(budget.softLimitPct));
    }
  }, [budget]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    update.mutate({ monthlyBudgetUsd: Number(limit), softLimitPct: Number(soft) });
  }

  return (
    <Card title={`Team budget${usage.data ? ` · ${usage.data.team.name}` : ''}`}>
      {budget && (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted">
          <span className="num text-ink">{formatUsd(budget.monthToDateUsd)}</span> spent this month
          <StatusBadge status={budget.state} label={budget.state === 'ok' ? 'Within budget' : undefined} />
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Monthly limit (USD)" hint="At 100% the gateway refuses new requests.">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            required
            className="font-mono"
          />
        </Field>
        <Field label="Soft limit (%)" hint="Past this point, requests are routed to cheaper models.">
          <Input
            type="number"
            min={1}
            max={100}
            value={soft}
            onChange={(e) => setSoft(e.target.value)}
            required
            className="font-mono"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="primary" busy={update.isPending}>
            Save budget
          </Button>
          {update.isSuccess && <span className="text-xs text-ok">Saved</span>}
        </div>
        {update.isError && <p className="text-xs text-bad">{errorMessage(update.error)}</p>}
      </form>
    </Card>
  );
}

function ModelsCard() {
  const models = useModels();
  return (
    <Card
      title="Models"
      flush
      actions={
        models.data?.mockFallback ? (
          <span className="text-xs text-muted">
            Mock fallback on: models without an API key are simulated (shown as <code>mock:…</code>)
          </span>
        ) : undefined
      }
    >
      {models.isLoading ? (
        <div className="px-4">
          <Loading />
        </div>
      ) : models.isError ? (
        <div className="p-4">
          <ErrorNote error={models.error} />
        </div>
      ) : (
        <Table head={['Model', 'Provider', 'Tier', 'Input $/MTok', 'Output $/MTok', 'Status']}>
          {models.data?.models.map((m) => (
            <tr key={m.id}>
              <td className="font-mono text-xs">{m.modelName}</td>
              <td className="text-muted">{m.provider}</td>
              <td>{humanize(m.tier)}</td>
              <td className="num">{formatUsd(m.inputUsdPerMTok)}</td>
              <td className="num">{formatUsd(m.outputUsdPerMTok)}</td>
              <td>
                {!m.enabled ? (
                  <StatusBadge status="disabled" tone="neutral" label="Disabled" />
                ) : m.circuitOpen ? (
                  <StatusBadge status="circuit" tone="bad" label="Circuit open" />
                ) : m.available ? (
                  <StatusBadge status="ok" label="Available" />
                ) : (
                  <StatusBadge status="nokey" tone="neutral" label="No API key" />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
