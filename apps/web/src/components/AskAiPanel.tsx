import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api/client';
import { useAskAi, useRun } from '../api/hooks';
import { shortId } from '../lib/format';
import { ApprovalCard } from './ApprovalCard';
import { RunMeter } from './RunMeter';
import { StatusBadge } from './StatusBadge';
import { Button, Card, Spinner, Textarea } from './ui';

const SUGGESTIONS = [
  'Summarise this lead and suggest a next step',
  'Add a note that we should call next week',
  'Which of their deals is most likely to close?',
  'Move their open deal to qualified',
];

export function AskAiPanel({ contactId, contactName }: { contactId: number; contactName: string }) {
  const ask = useAskAi();
  const [question, setQuestion] = useState('');
  const [runId, setRunId] = useState<string | null>(null);

  function submit(text: string) {
    const q = text.trim();
    if (!q) return;
    ask.mutate({ question: q, contactId }, { onSuccess: (run) => setRunId(run.id) });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(question);
  }

  return (
    <Card
      title="Ask AI"
      actions={<span className="text-xs text-muted">Changes to the CRM wait for your approval</span>}
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Textarea
          aria-label={`Ask about ${contactName}`}
          rows={3}
          placeholder={`Ask about ${contactName}, or tell the assistant what to do`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(question);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" busy={ask.isPending} disabled={!question.trim()}>
            Ask
          </Button>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={ask.isPending}
              onClick={() => {
                setQuestion(s);
                submit(s);
              }}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {ask.isPending && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Spinner className="size-3.5" /> The assistant is working…
        </p>
      )}
      {ask.isError && (
        <p className="mt-4 text-sm text-bad" role="alert">
          {errorMessage(ask.error)}
        </p>
      )}
      {runId && !ask.isPending && <RunResult runId={runId} />}
    </Card>
  );
}

function RunResult({ runId }: { runId: string }) {
  const run = useRun(runId);
  if (!run.data)
    return run.isError ? <p className="mt-4 text-sm text-bad">{errorMessage(run.error)}</p> : null;
  const r = run.data;
  const pending = r.approvals.filter((a) => a.status === 'pending');

  return (
    <div className="mt-5 space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={r.status} />
        <Link to={`/runs/${r.id}`} className="font-mono text-xs text-accent hover:underline">
          run {shortId(r.id)} →
        </Link>
      </div>
      {r.output && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{r.output}</p>}
      {r.status === 'failed' && <p className="text-sm text-bad">{r.error ?? 'The run failed.'}</p>}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            The assistant wants to make {pending.length === 1 ? 'a change' : 'these changes'}:
          </p>
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} compact onDecided={() => run.refetch()} />
          ))}
        </div>
      )}
      <RunMeter
        costUsd={r.totalCostUsd}
        tokens={r.totalTokens}
        promptVersion={r.promptVersion}
        llmCalls={r.llmCalls}
      />
    </div>
  );
}
