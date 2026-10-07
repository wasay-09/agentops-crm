import type { LlmCall } from '@agentops/contracts';
import { formatInt, formatMs, formatUsd, shortModel } from '../lib/format';
import { cx } from './ui';

/**
 * The receipt line printed under every AI answer: what it cost, how many tokens,
 * which model(s) served it and how long the model calls took.
 */
export function RunMeter({
  costUsd,
  tokens,
  promptVersion,
  llmCalls,
  className,
}: {
  costUsd: number;
  tokens: number;
  promptVersion?: number | null;
  llmCalls?: LlmCall[];
  className?: string;
}) {
  const models = llmCalls
    ? [...new Set(llmCalls.filter((c) => c.status === 'ok').map((c) => shortModel(c.model)))]
    : [];
  const latency = llmCalls?.reduce((s, c) => s + c.latencyMs, 0);
  const fallbacks = llmCalls?.filter((c) => c.routingReason !== 'primary').length ?? 0;
  const items: Array<[string, string]> = [
    ['cost', formatUsd(costUsd)],
    ['tokens', formatInt(tokens)],
  ];
  if (models.length) items.push(['model', models.join(' + ')]);
  if (latency != null && llmCalls?.length) items.push(['llm time', formatMs(latency)]);
  if (promptVersion != null) items.push(['prompt', `v${promptVersion}`]);
  if (fallbacks > 0) items.push(['rerouted', `${fallbacks}×`]);

  return (
    <dl className={cx('meter-stub flex flex-wrap gap-x-5 gap-y-1 pt-2.5 font-mono text-xs', className)}>
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1.5">
          <dt className="text-faint">{k}</dt>
          <dd className={cx('text-ink tabular-nums', k === 'rerouted' && 'text-pending')}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
