import type { TimelineEvent } from '@agentops/contracts';
import { describe, expect, it } from 'vitest';
import { layoutTimeline, timelineTicks } from './timeline';

const ev = (startedAt: string, durationMs: number | null, label = 'x'): TimelineEvent => ({
  kind: 'llm',
  label,
  startedAt,
  durationMs,
  status: 'ok',
});

describe('layoutTimeline', () => {
  it('returns an empty layout for no events', () => {
    expect(layoutTimeline([])).toEqual({ bars: [], totalMs: 0 });
  });

  it('positions bars relative to the first event and total span', () => {
    const { bars, totalMs } = layoutTimeline([
      ev('2026-10-07T10:00:01.000Z', 1000, 'b'),
      ev('2026-10-07T10:00:00.000Z', 1000, 'a'),
    ]);
    expect(totalMs).toBe(2000);
    expect(bars.map((b) => b.event.label)).toEqual(['a', 'b']);
    expect(bars[0]).toMatchObject({ left: 0, width: 0.5, offsetMs: 0 });
    expect(bars[1]).toMatchObject({ left: 0.5, width: 0.5, offsetMs: 1000 });
  });

  it('gives instant events a minimum width', () => {
    const { bars } = layoutTimeline(
      [ev('2026-10-07T10:00:00.000Z', 1000), ev('2026-10-07T10:00:00.500Z', null)],
      0.01,
    );
    expect(bars[1]!.width).toBe(0.01);
  });
});

describe('timelineTicks', () => {
  it('spreads ticks evenly', () => {
    expect(timelineTicks(1000, 4)).toEqual([0, 250, 500, 750, 1000]);
  });
});
