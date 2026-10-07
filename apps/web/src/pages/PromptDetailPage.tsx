import type { DeploymentWeight, Prompt } from '@agentops/contracts';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { errorMessage } from '../api/client';
import { useCreatePromptVersion, usePrompt, useUpdateDeployment } from '../api/hooks';
import { Button, Card, cx, ErrorNote, Field, Input, Loading, PageHeader, Textarea } from '../components/ui';
import { formatDateTime, formatRelative } from '../lib/format';
import { checkWeights, compactWeights, describeDeployment, pinVersion } from '../lib/weights';

export function PromptDetailPage() {
  const name = decodeURIComponent(useParams().name ?? '');
  const prompt = usePrompt(name);
  if (prompt.isLoading) return <Loading />;
  if (prompt.isError || !prompt.data) return <ErrorNote error={prompt.error ?? 'Prompt not found'} />;
  const p = prompt.data;
  const versions = [...p.versions].sort((a, b) => b.version - a.version);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/prompts" className="hover:text-ink">
            ← Prompts
          </Link>
        }
        title={<span className="font-mono text-[24px] tracking-normal">{p.name}</span>}
        subtitle={p.description ?? undefined}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {versions.map((v) => {
            const weight = p.deployment.find((w) => w.version === v.version)?.weight ?? 0;
            return (
              <Card
                key={v.id}
                title={
                  <span className="flex items-center gap-2">
                    <span className="font-mono">v{v.version}</span>
                    {weight > 0 && (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                        live · {weight}%
                      </span>
                    )}
                  </span>
                }
                actions={<RollbackButton prompt={p} version={v.version} live={weight === 100} />}
              >
                {v.notes && <p className="mb-2 text-sm">{v.notes}</p>}
                <p className="mb-3 text-xs text-muted">
                  {v.createdBy ?? 'unknown'} · {formatDateTime(v.createdAt)}
                </p>
                <pre className="max-h-80 overflow-auto rounded-md bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {v.template}
                </pre>
              </Card>
            );
          })}
        </div>
        <div className="space-y-5">
          <DeploymentEditor prompt={p} />
          <NewVersionForm prompt={p} />
        </div>
      </div>
    </>
  );
}

function RollbackButton({ prompt, version, live }: { prompt: Prompt; version: number; live: boolean }) {
  const update = useUpdateDeployment(prompt.name);
  if (live) return null;
  const latest = Math.max(...prompt.versions.map((v) => v.version));
  return (
    <Button
      size="sm"
      busy={update.isPending}
      onClick={() => update.mutate(pinVersion(version))}
      title={update.isError ? errorMessage(update.error) : undefined}
    >
      {version < latest ? `Roll back to v${version}` : `Send all traffic to v${version}`}
    </Button>
  );
}

function DeploymentEditor({ prompt }: { prompt: Prompt }) {
  const update = useUpdateDeployment(prompt.name);
  const initial = (): DeploymentWeight[] =>
    [...prompt.versions]
      .sort((a, b) => a.version - b.version)
      .map((v) => ({
        version: v.version,
        weight: prompt.deployment.find((w) => w.version === v.version)?.weight ?? 0,
      }));
  const [weights, setWeights] = useState<DeploymentWeight[]>(initial);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the editor when the saved prompt changes
  useEffect(() => setWeights(initial()), [prompt]);

  const check = checkWeights(compactWeights(weights).length ? compactWeights(weights) : weights);
  const dirty = JSON.stringify(compactWeights(weights)) !== JSON.stringify(compactWeights(prompt.deployment));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (check.ok) update.mutate(compactWeights(weights));
  }

  return (
    <Card title="Deployment">
      <p className="mb-3 text-sm text-muted">
        Now: <span className="text-ink">{describeDeployment(prompt.deployment)}</span>
        {prompt.deploymentUpdatedAt && (
          <>
            {' '}
            · changed {formatRelative(prompt.deploymentUpdatedAt)}
            {prompt.deploymentUpdatedBy && ` by ${prompt.deploymentUpdatedBy}`}
          </>
        )}
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        {weights.map((w, i) => (
          <div key={w.version} className="flex items-center gap-3">
            <span className="w-8 font-mono text-sm">v{w.version}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={w.weight}
              aria-label={`Weight for v${w.version}`}
              onChange={(e) =>
                setWeights((ws) => ws.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))
              }
              className="flex-1 accent-[var(--accent)]"
            />
            <Input
              type="number"
              min={0}
              max={100}
              value={w.weight}
              aria-label={`Weight for v${w.version} (percent)`}
              onChange={(e) =>
                setWeights((ws) => ws.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))
              }
              className="h-8 w-16 px-2 text-right font-mono"
            />
          </div>
        ))}
        <p className={cx('text-xs', check.ok ? 'text-muted' : 'text-bad')}>
          {check.ok ? `Total ${check.total}%` : check.message}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            busy={update.isPending}
            disabled={!check.ok || !dirty}
          >
            Save weights
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setWeights(initial())}>
              Reset
            </Button>
          )}
        </div>
        {update.isError && <p className="text-xs text-bad">{errorMessage(update.error)}</p>}
      </form>
    </Card>
  );
}

function NewVersionForm({ prompt }: { prompt: Prompt }) {
  const create = useCreatePromptVersion(prompt.name);
  const latest = [...prompt.versions].sort((a, b) => b.version - a.version)[0];
  const [template, setTemplate] = useState(latest?.template ?? '');
  const [notes, setNotes] = useState('');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ template, notes: notes || undefined }, { onSuccess: () => setNotes('') });
  }

  return (
    <Card title="New version">
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-xs text-muted">
          Starts from the latest version. Use <code className="font-mono">{'{{variable}}'}</code>{' '}
          placeholders. A new version gets no traffic until you change the deployment.
        </p>
        <Textarea
          aria-label="Template"
          rows={10}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="font-mono text-xs"
          required
        />
        <Field label="What changed">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Shorter answers, cite deal ids"
          />
        </Field>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          busy={create.isPending}
          disabled={!template.trim() || template === latest?.template}
        >
          Save as v{(latest?.version ?? 0) + 1}
        </Button>
        {create.isError && <p className="text-xs text-bad">{errorMessage(create.error)}</p>}
      </form>
    </Card>
  );
}
