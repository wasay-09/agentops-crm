import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, SALES_KEY, type TestContext } from './helpers.js';

let ctx: TestContext;
afterEach(async () => ctx?.close());

async function setup(budget: number) {
  ctx = await createTestContext();
  const { rows } = await ctx.handle.pool.query(
    "update teams set monthly_budget_usd = $1 where name = 'sales' returning id",
    [budget],
  );
  return rows[0].id as string;
}

async function spend(teamId: string, usd: number) {
  await ctx.handle.pool.query(
    `insert into llm_calls (team_id, task_type, step, attempt, provider, model, routing_reason, status, cost_usd, latency_ms, started_at)
     values ($1, 'chat', 1, 1, 'mock', 'mock:x', 'primary', 'ok', $2, 10, now())`,
    [teamId, usd],
  );
}

describe('BudgetService', () => {
  it('reports ok / soft / hard from month-to-date spend', async () => {
    const id = await setup(10);
    expect((await ctx.services.budget.status(id)).state).toBe('ok');
    await spend(id, 8);
    expect((await ctx.services.budget.status(id)).state).toBe('soft');
    await spend(id, 2);
    expect(await ctx.services.budget.status(id)).toMatchObject({ state: 'hard', monthToDateUsd: 10 });
  });

  it('ignores spend from previous months', async () => {
    const id = await setup(10);
    await ctx.handle.pool.query(
      `insert into llm_calls (team_id, task_type, step, attempt, provider, model, routing_reason, status, cost_usd, latency_ms, started_at)
       values ($1, 'chat', 1, 1, 'mock', 'mock:x', 'primary', 'ok', 50, 10, date_trunc('month', now()) - interval '1 day')`,
      [id],
    );
    expect((await ctx.services.budget.status(id)).state).toBe('ok');
  });

  it('bounds concurrent overspend to one reservation', async () => {
    const id = await setup(1);
    // 20 concurrent callers each want to reserve $0.30 against a $1 budget.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => ctx.services.budget.reserve(id, 0.3)),
    );
    const granted = results.filter((r) => r.status === 'fulfilled').length;
    expect(granted).toBe(4); // 0, 0.3, 0.6, 0.9 are under the limit; the 5th sees 1.2 committed
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 402, code: 'budget_exceeded' });
  });

  it('purges expired reservations', async () => {
    const id = await setup(1);
    await ctx.services.budget.reserve(id, 0.5);
    await ctx.handle.pool.query("update budget_reservations set expires_at = now() - interval '1 second'");
    expect(await ctx.services.budget.purgeExpired()).toBe(1);
  });

  it('downgrades to the budget model over the soft limit and returns 402 at the hard limit', async () => {
    const id = await setup(1);
    await spend(id, 0.85);
    const soft = await ctx.app.inject({
      method: 'POST',
      url: '/v1/complete',
      headers: { authorization: `Bearer ${SALES_KEY}` },
      payload: { taskType: 'chat', prompt: 'hi' },
    });
    expect(soft.statusCode).toBe(200);
    expect(soft.json()).toMatchObject({ routingReason: 'budget_downgrade', model: 'mock:claude-haiku-4-5' });

    await spend(id, 0.2);
    const hard = await ctx.app.inject({
      method: 'POST',
      url: '/v1/complete',
      headers: { authorization: `Bearer ${SALES_KEY}` },
      payload: { taskType: 'chat', prompt: 'hi' },
    });
    expect(hard.statusCode).toBe(402);
    expect(hard.json().error.code).toBe('budget_exceeded');
  });
});
