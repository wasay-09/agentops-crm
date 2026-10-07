import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { useContacts, useCreateContact } from '../api/hooks';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Table,
} from '../components/ui';
import { formatUsd } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';

export function ContactsPage() {
  const [q, setQ] = useState('');
  const query = useDebounced(q);
  const contacts = useContacts(query);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Open a contact to ask the assistant about them or run the follow-up workflow."
        actions={
          <Button variant={adding ? 'secondary' : 'primary'} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add contact'}
          </Button>
        }
      />
      {adding && <NewContactForm onDone={() => setAdding(false)} />}
      <Card
        flush
        title={
          <Input
            type="search"
            aria-label="Search contacts"
            placeholder="Search by name, email or company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-72 max-w-full font-normal"
          />
        }
        actions={contacts.isFetching && <span className="text-xs text-muted">Searching…</span>}
      >
        {contacts.isLoading ? (
          <div className="px-4">
            <Loading />
          </div>
        ) : contacts.isError ? (
          <div className="p-4">
            <ErrorNote error={contacts.error} />
          </div>
        ) : contacts.data && contacts.data.length === 0 ? (
          <div className="p-4">
            <EmptyState title={query ? `No contacts match “${query}”` : 'No contacts yet'}>
              {query ? 'Try a company name or part of an email.' : 'Add a contact to get started.'}
            </EmptyState>
          </div>
        ) : (
          <Table head={['Name', 'Company', 'Title', 'Email', 'Open deals', 'Pipeline']}>
            {contacts.data?.map((c) => (
              <tr key={c.id} className="hover:bg-sunken/60">
                <td>
                  <Link
                    to={`/contacts/${c.id}`}
                    className="font-medium text-ink hover:text-accent hover:underline"
                  >
                    {c.name}
                  </Link>
                </td>
                <td>{c.company}</td>
                <td className="text-muted">{c.title ?? '—'}</td>
                <td className="text-muted">{c.email}</td>
                <td className="num">{c.openDeals}</td>
                <td className="num">{formatUsd(c.pipelineUsd)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function NewContactForm({ onDone }: { onDone: () => void }) {
  const create = useCreateContact();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', company: '', title: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name: form.name, email: form.email, company: form.company, title: form.title || undefined },
      {
        onSuccess: (c) => {
          onDone();
          navigate(`/contacts/${c.id}`);
        },
      },
    );
  }

  return (
    <Card title="New contact" className="mb-5">
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input required value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email">
          <Input required type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Company">
          <Input required value={form.company} onChange={set('company')} />
        </Field>
        <Field label="Title">
          <Input value={form.title} onChange={set('title')} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" variant="primary" busy={create.isPending}>
            Save contact
          </Button>
          {create.isError && <span className="text-sm text-bad">{errorMessage(create.error)}</span>}
        </div>
      </form>
    </Card>
  );
}
