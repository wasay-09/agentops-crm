import type { TimelineEvent } from '@agentops/contracts';
import { formatMs } from '../lib/format';
import { layoutTimeline, timelineTicks } from '../lib/timeline';
import { cx } from './ui';

const KIND_BAR: Record<TimelineEvent['kind'], string> = {
  llm: 'bg-accent',
  tool: 'bg-info',
  approval: 'bg-pending',
};

/** Waterfall of a run: one row per LLM call, tool call or approval, positioned by start time. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  const { bars, totalMs } = layoutTimeline(events);
  if (bars.length === 0) return <p className="text-sm text-muted">No events recorded for this run.</p>;
  const ticks = timelineTicks(totalMs);

  return (
    <div className="text-sm">
      <div className="mb-3 flex gap-4 text-xs text-muted">
        {(['llm', 'tool', 'approval'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cx('size-2 rounded-sm', KIND_BAR[k])} />
            {k === 'llm' ? 'Model call' : k === 'tool' ? 'Tool call' : 'Approval'}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(9rem,14rem)_1fr_4.5rem] items-center gap-x-3">
        <div />
        <div className="relative h-5 border-b border-line">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-faint first:translate-x-0 last:-translate-x-full"
              style={{ left: `${(t / totalMs) * 100}%` }}
            >
              {formatMs(t)}
            </span>
          ))}
        </div>
        <div />
        {bars.map(({ event, left, width }, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: events have no id; order is stable
          <div key={i} className="contents">
            <div className="truncate py-1.5" title={event.detail ?? event.label}>
              <span
                className={cx(
                  event.status === 'error' || event.status === 'failed' ? 'text-bad' : 'text-ink',
                )}
              >
                {event.label}
              </span>
            </div>
            <div className="relative h-6 rounded bg-sunken/60">
              <div
                className={cx(
                  'absolute top-1 bottom-1 rounded-sm',
                  KIND_BAR[event.kind],
                  (event.status === 'error' || event.status === 'failed') && 'bg-bad',
                  event.durationMs == null && 'opacity-60',
                )}
                style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                title={`${event.label} — ${event.status}${event.detail ? ` — ${event.detail}` : ''}`}
              />
            </div>
            <div className="text-right font-mono text-xs text-muted tabular-nums">
              {event.durationMs == null ? event.status : formatMs(event.durationMs)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
