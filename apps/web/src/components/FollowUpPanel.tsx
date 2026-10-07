import type { WorkflowStepState } from '@agentops/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api/client';
import { useApprovals, useStartFollowUp, useWorkflowRun } from '../api/hooks';
import { prettyJson } from '../lib/payload';
import { ApprovalCard } from './ApprovalCard';
import { StatusBadge } from './StatusBadge';
import { Button, Card, cx } from './ui';

const STEP_DOT: Record<WorkflowStepState['status'], string> = {
  pending: 'border-line-strong bg-surface',
  running: 'border-info bg-info animate-pulse',
  waiting: 'border-pending bg-pending',
  completed: 'border-ok bg-ok',
  skipped: 'border-line-strong bg-sunken',
  failed: 'border-bad bg-bad',
};

export function FollowUpPanel({ contactId }: { contactId: number }) {
  const start = useStartFollowUp();
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const wf = useWorkflowRun(workflowId);
  const pending = useApprovals('pending');
  const run = wf.data;
  const active = run && (run.status === 'running' || run.status === 'awaiting_approval');

  return (
    <Card
      title="Follow-up workflow"
      actions={
        <Button
          size="sm"
          variant={run ? 'secondary' : 'primary'}
          busy={start.isPending}
          disabled={!!active}
          onClick={() => start.mutate(contactId, { onSuccess: (w) => setWorkflowId(w.id) })}
        >
          {run ? 'Run again' : 'Run follow-up'}
        </Button>
      }
    >
      {!run && !start.isPending && (
        <p className="text-sm text-muted">
          Summarises the lead, drafts a follow-up email for you to approve, then logs it on the contact and
          moves a new lead to qualified.
        </p>
      )}
      {start.isError && <p className="text-sm text-bad">{errorMessage(start.error)}</p>}
      {run && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            {run.error && <span className="text-sm text-bad">{run.error}</span>}
          </div>
          <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-line">
            {run.steps.map((step) => {
              const approval = step.approvalId
                ? pending.data?.find((a) => a.id === step.approvalId)
                : undefined;
              return (
                <li key={step.id} className="relative pl-6">
                  <span
                    className={cx(
                      'absolute top-1.5 left-0 size-[11px] rounded-full border-2',
                      STEP_DOT[step.status],
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{step.label}</span>
                    <span className="text-xs text-muted">{step.type}</span>
                    {step.status !== 'completed' && step.status !== 'pending' && (
                      <StatusBadge status={step.status} />
                    )}
                    {step.runId && (
                      <Link
                        to={`/runs/${step.runId}`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        run →
                      </Link>
                    )}
                  </div>
                  {step.status === 'waiting' && approval && (
                    <div className="mt-2">
                      <ApprovalCard approval={approval} onDecided={() => wf.refetch()} />
                    </div>
                  )}
                  {step.status === 'completed' && step.output != null && <StepOutput output={step.output} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}

function StepOutput({ output }: { output: unknown }) {
  const text =
    typeof output === 'string'
      ? output
      : output && typeof output === 'object' && 'text' in output && typeof output.text === 'string'
        ? output.text
        : prettyJson(output);
  return (
    <details className="mt-1.5 text-sm">
      <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show output</summary>
      <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-[13px] leading-relaxed">
        {text}
      </p>
    </details>
  );
}
