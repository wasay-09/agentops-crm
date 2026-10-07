import { RUN_STATUSES, type RunStatus } from '@agentops/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { useRuns } from '../api/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { Card, EmptyState, ErrorNote, Loading, PageHeader, Select, Table } from '../components/ui';
import { formatInt, formatRelative, formatUsd, humanize, shortId } from '../lib/format';

const AGENTS = ['crm-assistant', 'lead-summarizer', 'email-drafter'];

export function RunsPage() {
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const runs = useRuns(agent || undefined, status || undefined);

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every agent run for your team, newest first. Open one to see its model and tool calls."
      />
      <Card
        flush
        title={
          <div className="flex flex-wrap gap-2 font-normal">
            <Select
              aria-label="Agent"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              className="h-8 w-44"
            >
              <option value="">All agents</option>
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as RunStatus | '')}
              className="h-8 w-44"
            >
              <option value="">Any status</option>
              {RUN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        {runs.isLoading ? (
          <div className="px-4">
            <Loading />
          </div>
        ) : runs.isError ? (
          <div className="p-4">
            <ErrorNote error={runs.error} />
          </div>
        ) : runs.data?.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No runs match these filters" />
          </div>
        ) : (
          <Table head={['Run', 'Agent', 'Input', 'Status', 'Prompt', 'Tokens', 'Cost', 'Started', 'By']}>
            {runs.data?.map((r) => (
              <tr key={r.id} className="hover:bg-sunken/60">
                <td>
                  <Link to={`/runs/${r.id}`} className="font-mono text-xs text-accent hover:underline">
                    {shortId(r.id)}
                  </Link>
                </td>
                <td className="whitespace-nowrap">{r.agent}</td>
                <td className="max-w-72 truncate text-muted" title={r.input}>
                  {r.input}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="num text-muted">{r.promptVersion != null ? `v${r.promptVersion}` : '—'}</td>
                <td className="num">{formatInt(r.totalTokens)}</td>
                <td className="num">{formatUsd(r.totalCostUsd)}</td>
                <td className="whitespace-nowrap text-muted">{formatRelative(r.createdAt)}</td>
                <td className="max-w-40 truncate text-muted">{r.actor ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
