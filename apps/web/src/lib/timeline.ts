import type { TimelineEvent } from '@agentops/contracts';

export interface TimelineBar {
  event: TimelineEvent;
  /** Offset from the first event, as a fraction of the total span (0..1). */
  left: number;
  /** Width as a fraction of the total span; never below `minWidth` so instant events stay visible. */
  width: number;
  offsetMs: number;
}

export interface TimelineLayout {
  bars: TimelineBar[];
  totalMs: number;
}

/**
 * Lays out timeline events as a waterfall. Events without a duration (e.g. a pending approval)
 * get a minimum width. Events are sorted by start time.
 */
export function layoutTimeline(events: TimelineEvent[], minWidth = 0.006): TimelineLayout {
  const parsed = events
    .map((event) => ({ event, start: new Date(event.startedAt).getTime() }))
    .filter((e) => Number.isFinite(e.start))
    .sort((a, b) => a.start - b.start);
  if (parsed.length === 0) return { bars: [], totalMs: 0 };

  const t0 = parsed[0]!.start;
  const end = Math.max(...parsed.map((p) => p.start + (p.event.durationMs ?? 0)));
  const totalMs = Math.max(end - t0, 1);

  const bars = parsed.map(({ event, start }) => {
    const offsetMs = start - t0;
    const left = Math.min(offsetMs / totalMs, 1);
    const raw = (event.durationMs ?? 0) / totalMs;
    const width = Math.min(Math.max(raw, minWidth), 1 - left || minWidth);
    return { event, left, width, offsetMs };
  });
  return { bars, totalMs };
}

/** Evenly spaced tick positions (ms) for a timeline axis. */
export function timelineTicks(totalMs: number, count = 4): number[] {
  if (totalMs <= 0) return [0];
  const step = totalMs / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step));
}
