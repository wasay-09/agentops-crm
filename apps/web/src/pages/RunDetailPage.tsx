import type { RunDetail } from '@agentops/contracts';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useRun } from '../api/hooks';
import { ApprovalCard } from '../components/ApprovalCard';
import { RunMeter } from '../components/RunMeter';
import { StatusBadge } from '../components/StatusBadge';
import { Timeline } from '../components/Timeline';
import { Card, ErrorNote, Loading, PageHeader, Table } from '../components/ui';
import { formatDateTime, formatInt, formatMs, formatUsd, humanize, shortId, shortModel } from '../lib/format';
import { prettyJson } from '../lib/payload';

const TRACE_TEMPLATE = import.meta.env.VITE_TRACE_URL_TEMPLATE as string | undefined;

export function RunDetailPage() {
  const id = useParams().id ?? '';
  const run = useRun(id);
  if (run.isLoading) return <Loading />;
  if (run.isError || !run.data) return <ErrorNote error={run.error ?? 'Run not found'} />;
  const r = run.data;
  const traceUrl = r.traceId && TRACE_TEMPLATE ? TRACE_TEMPLATE.replace('{traceId}', r.traceId) : null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/runs" className="hover:text-ink">
            ← Runs
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.agent} <span className="font-mono text-base font-normal text-muted">{shortId(r.id)}</span>
          </span>
        }
        actions={<StatusBadge status={r.status} />}
      />
      <div className="space-y-5">
        <Card>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Started">{formatDateTime(r.createdAt)}</Meta>
            <Meta label="Finished">{formatDateTime(r.completedAt)}</Meta>
            <Meta label="Triggered by">{r.actor ?? '—'}</Meta>
            <Meta label="Trace">
              {traceUrl ? (
                <a href={traceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  Open trace ↗
                </a>
              ) : (
                <span className="font-mono text-xs text-muted">{r.traceId ? shortId(r.traceId) : '—'}</span>
              )}
            </Meta>
            {r.workflowRunId && <Meta label="Workflow">Part of workflow {shortId(r.workflowRunId)}</Meta>}
          </dl>
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 text-xs font-medium text-muted">Input</div>
              <p className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-sm">{r.input}</p>
            </div>
            {r.output && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">Output</div>
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{r.output}</p>
              </div>
            )}
            {r.error && <p className="text-sm text-bad">Error: {r.error}</p>}
          </div>
          <RunMeter
            className="mt-4"
            costUsd={r.totalCostUsd}
            tokens={r.totalTokens}
            promptVersion={r.promptVersion}
            llmCalls={r.llmCalls}
          />
        </Card>

        {r.approvals.some((a) => a.status === 'pending') && (
          <div className="space-y-2">
            {r.approvals
              .filter((a) => a.status === 'pending')
              .map((a) => (
                <ApprovalCard key={a.id} approval={a} onDecided={() => run.refetch()} />
              ))}
          </div>
        )}

        <Card title="Timeline">
          <Timeline events={r.timeline} />
        </Card>
        <LlmCallsTable run={r} />
        <ToolCallsTable run={r} />
      </div>
    </>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function LlmCallsTable({ run }: { run: RunDetail }) {
  return (
    <Card title={`Model calls (${run.llmCalls.length})`} flush>
      <Table head={['Step', 'Model', 'Routing', 'Status', 'In', 'Out', 'Cost', 'Latency']}>
        {run.llmCalls.map((c) => (
          <tr key={c.id}>
            <td className="num text-muted">
              {c.step}.{c.attempt}
            </td>
            <td className="font-mono text-xs">
              {shortModel(c.model)} <span className="text-faint">{c.provider}</span>
            </td>
            <td>
              {c.routingReason === 'primary' ? (
                <span className="text-muted">Primary</span>
              ) : (
                <StatusBadge status={c.routingReason} tone="pending" />
              )}
            </td>
            <td>
              <StatusBadge status={c.status} />
              {c.errorCode && <span className="ml-2 font-mono text-xs text-bad">{c.errorCode}</span>}
            </td>
            <td className="num">{formatInt(c.inputTokens)}</td>
            <td className="num">{formatInt(c.outputTokens)}</td>
            <td className="num">{formatUsd(c.costUsd)}</td>
            <td className="num">{formatMs(c.latencyMs)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function ToolCallsTable({ run }: { run: RunDetail }) {
  if (run.toolCalls.length === 0) return null;
  return (
    <Card title={`Tool calls (${run.toolCalls.length})`} flush>
      <Table head={['Step', 'Tool', 'Mode', 'Status', 'Arguments', 'Result', 'Latency']}>
        {run.toolCalls.map((t) => (
          <tr key={t.id} className="align-top">
            <td className="num text-muted">{t.step}</td>
            <td className="font-mono text-xs">{t.toolName}</td>
            <td className="text-muted">{humanize(t.mode)}</td>
            <td>
              <StatusBadge status={t.status} />
            </td>
            <td>
              <Json value={t.args} />
            </td>
            <td>
              <Json value={t.result} />
            </td>
            <td className="num">{formatMs(t.latencyMs)}</td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function Json({ value }: { value: unknown }) {
  if (value == null) return <span className="text-faint">—</span>;
  const text = prettyJson(value);
  if (text.length < 80) return <code className="font-mono text-xs break-all">{text}</code>;
  return (
    <details>
      <summary className="cursor-pointer font-mono text-xs text-muted">{text.slice(0, 48)}…</summary>
      <pre className="mt-1 max-h-72 max-w-md overflow-auto rounded bg-sunken p-2 font-mono text-[11px]">
        {text}
      </pre>
    </details>
  );
}
