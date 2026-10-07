import { DEAL_STAGES, type DealStage } from '@agentops/contracts';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { errorMessage } from '../api/client';
import { useAddNote, useContact, useUpdateDealStage } from '../api/hooks';
import { AskAiPanel } from '../components/AskAiPanel';
import { FollowUpPanel } from '../components/FollowUpPanel';
import { StatusBadge } from '../components/StatusBadge';
import { Button, Card, ErrorNote, Loading, PageHeader, Select, Textarea } from '../components/ui';
import { formatDateTime, formatUsd, humanize } from '../lib/format';

export function ContactDetailPage() {
  const id = Number(useParams().id);
  const contact = useContact(id);

  if (contact.isLoading) return <Loading />;
  if (contact.isError || !contact.data) return <ErrorNote error={contact.error ?? 'Contact not found'} />;
  const c = contact.data;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/contacts" className="hover:text-ink">
            ← Contacts
          </Link>
        }
        title={c.name}
        subtitle={[c.title, c.company].filter(Boolean).join(' at ')}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <AskAiPanel contactId={c.id} contactName={c.name} />
          <FollowUpPanel contactId={c.id} />
        </div>
        <div className="space-y-5">
          <Card title="Details">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Email</dt>
              <dd className="break-all">{c.email}</dd>
              <dt className="text-muted">Phone</dt>
              <dd>{c.phone ?? '—'}</dd>
              <dt className="text-muted">Company</dt>
              <dd>{c.company}</dd>
              <dt className="text-muted">Added</dt>
              <dd>{formatDateTime(c.createdAt)}</dd>
            </dl>
          </Card>
          <DealsCard deals={c.deals} />
          <NotesCard contactId={c.id} notes={c.notes} />
        </div>
      </div>
    </>
  );
}

function DealsCard({ deals }: { deals: import('@agentops/contracts').Deal[] }) {
  const update = useUpdateDealStage();
  return (
    <Card title={`Deals (${deals.length})`} flush>
      {deals.length === 0 ? (
        <p className="p-4 text-sm text-muted">No deals for this contact.</p>
      ) : (
        <ul className="divide-y divide-line">
          {deals.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{d.title}</div>
                <div className="num text-xs text-muted">{formatUsd(d.valueUsd)}</div>
              </div>
              <Select
                aria-label={`Stage for ${d.title}`}
                value={d.stage}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ dealId: d.id, stage: e.target.value as DealStage })}
                className="h-8 w-32"
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
      )}
      {update.isError && <p className="px-4 pb-3 text-xs text-bad">{errorMessage(update.error)}</p>}
    </Card>
  );
}

function NotesCard({ contactId, notes }: { contactId: number; notes: import('@agentops/contracts').Note[] }) {
  const add = useAddNote(contactId);
  const [body, setBody] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    add.mutate(body.trim(), { onSuccess: () => setBody('') });
  }

  return (
    <Card title={`Notes (${notes.length})`}>
      <form onSubmit={onSubmit} className="mb-4 space-y-2">
        <Textarea
          aria-label="New note"
          rows={2}
          placeholder="Write a note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" busy={add.isPending} disabled={!body.trim()}>
            Add note
          </Button>
          {add.isError && <span className="text-xs text-bad">{errorMessage(add.error)}</span>}
        </div>
      </form>
      {notes.length === 0 ? (
        <p className="text-sm text-muted">No notes yet.</p>
      ) : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="border-l-2 border-line pl-3">
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {/^AI\b/.test(n.author) ? (
                  <StatusBadge status="ai" tone="accent" label={n.author} />
                ) : (
                  n.author
                )}
                <span className="whitespace-nowrap">· {formatDateTime(n.createdAt)}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
