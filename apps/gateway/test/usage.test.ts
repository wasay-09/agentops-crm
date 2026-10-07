import { afterEach, describe, expect, it } from 'vitest';
import { auth, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
afterEach(async () => ctx?.close());

describe('usage summary', () => {
  it('aggregates cost, latency, errors, prompt versions and routing reasons from the ledger', async () => {
    ctx = await createTestContext();
    for (let i = 0; i < 4; i++) {
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/runs',
        headers: { ...auth(), 'idempotency-key': `usage-test-${i}` },
        payload: { agent: 'crm-assistant', input: 'Summarise', context: { contactId: 1 } },
      });
    }
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/complete',
      headers: { ...auth(), 'x-fault-model': 'mock:claude-haiku-4-5' },
      payload: { taskType: 'summarize', prompt: 'Summarise this.' },
    });

    const u = (
      await ctx.app.inject({ method: 'GET', url: '/v1/usage/summary?days=7', headers: auth() })
    ).json();
    expect(u.team.name).toBe('sales');
    expect(u.totals.runs).toBe(4);
    expect(u.totals.calls).toBe(11); // 4 runs × 2 calls + 2 failed attempts + 1 fallback success
    expect(u.totals.errorRate).toBeCloseTo(2 / 11, 3);
    expect(u.byAgent.map((a: { agent: string }) => a.agent).sort()).toEqual(['(direct)', 'crm-assistant']);
    expect(u.byPromptVersion.reduce((s: number, p: { runs: number }) => s + p.runs, 0)).toBe(4);
    expect(u.routingReasons).toContainEqual({ reason: 'fallback', calls: 1 });
    expect(u.budget).toMatchObject({ state: 'ok', monthlyLimitUsd: 50 });
    const daySum = u.costByDayAgent.reduce((s: number, d: { costUsd: number }) => s + d.costUsd, 0);
    expect(daySum).toBeCloseTo(u.totals.costUsd, 5);
  });
});
