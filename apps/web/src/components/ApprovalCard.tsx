import type { Approval } from '@agentops/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api/client';
import { useDecideApproval } from '../api/hooks';
import { formatRelative, humanize, shortId } from '../lib/format';
import { prettyJson, readPayload } from '../lib/payload';
import { StatusBadge } from './StatusBadge';
import { Button, cx, Input } from './ui';

/** One approval request: what the agent wants to do, and the controls to allow or refuse it. */
export function ApprovalCard({
  approval,
  compact,
  onDecided,
}: {
  approval: Approval;
  compact?: boolean;
  onDecided?: () => void;
}) {
  const decide = useDecideApproval();
  const [note, setNote] = useState('');
  const { tool, args, draft, rest } = readPayload(approval.payload);
  const pending = approval.status === 'pending';

  const submit = (decision: 'approve' | 'reject') =>
    decide.mutate({ id: approval.id, decision, note }, { onSuccess: () => onDecided?.() });

  return (
    <article
      className={cx(
        'rounded-lg border bg-surface',
        pending ? 'border-pending/40 shadow-[inset_3px_0_0_var(--pending)]' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h3 className="font-medium text-ink">{approval.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {approval.kind === 'tool_call' ? 'Agent tool call' : 'Workflow step'}
            {approval.requestedBy && <> · requested by {approval.requestedBy}</>} ·{' '}
            {formatRelative(approval.createdAt)}
            {approval.runId && (
              <>
                {' · '}
                <Link className="text-accent hover:underline" to={`/runs/${approval.runId}`}>
                  run {shortId(approval.runId)}
                </Link>
              </>
            )}
          </p>
        </div>
        <StatusBadge status={approval.status} />
      </div>

      <div className="space-y-2 px-4 py-3">
        {tool && (
          <div className="rounded-md bg-sunken px-3 py-2">
            <div className="font-mono text-xs text-muted">
              tool <span className="text-ink">{tool}</span>
            </div>
            {args != null && <ArgsView args={args} />}
          </div>
        )}
        {draft && (
          <div className="rounded-md border border-line bg-paper px-4 py-3">
            {draft.subject && (
              <div className="mb-2 border-b border-line pb-2 text-sm">
                <span className="text-muted">Subject: </span>
                <span className="font-medium">{draft.subject}</span>
              </div>
            )}
            <p className={cx('whitespace-pre-wrap text-sm leading-relaxed', compact && 'line-clamp-6')}>
              {draft.body}
            </p>
          </div>
        )}
        {!tool && !draft && (
          <pre className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-xs">
            {prettyJson(approval.payload)}
          </pre>
        )}
        {tool && Object.keys(rest).length > 0 && !compact && (
          <pre className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-xs text-muted">
            {prettyJson(rest)}
          </pre>
        )}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <Input
            aria-label="Note (optional)"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 min-w-48 flex-1"
          />
          <Button
            variant="danger"
            size="sm"
            onClick={() => submit('reject')}
            busy={decide.isPending && decide.variables?.decision === 'reject'}
            disabled={decide.isPending}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => submit('approve')}
            busy={decide.isPending && decide.variables?.decision === 'approve'}
            disabled={decide.isPending}
          >
            Approve
          </Button>
          {decide.isError && <p className="w-full text-xs text-bad">{errorMessage(decide.error)}</p>}
        </div>
      ) : (
        <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
          {humanize(approval.status)} by {approval.decidedBy ?? 'unknown'} ·{' '}
          {formatRelative(approval.decidedAt)}
          {approval.note && <> — “{approval.note}”</>}
        </p>
      )}
    </article>
  );
}

function ArgsView({ args }: { args: unknown }) {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return (
      <dl className="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
        {Object.entries(args as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-xs leading-5 text-muted">{k}</dt>
            <dd className="whitespace-pre-wrap break-words">{typeof v === 'string' ? v : prettyJson(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <pre className="mt-1 font-mono text-xs">{prettyJson(args)}</pre>;
}
