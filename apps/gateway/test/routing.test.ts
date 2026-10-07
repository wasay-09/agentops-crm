import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/types.js';
import { CircuitBreaker } from '../src/routing/breaker.js';
import { createTestContext, ScriptedProvider, type TestContext, text } from './helpers.js';

let ctx: TestContext;
afterEach(async () => ctx?.close());

describe('Router.plan', () => {
  it('simulates the whole chain with the mock provider when no provider is configured', async () => {
    ctx = await createTestContext();
    const plan = await ctx.services.router.plan('chat', 'ok');
    expect(plan.candidates.map((c) => [c.model.id, c.reason])).toEqual([
      ['mock:claude-sonnet-5-5', 'primary'],
      ['mock:gpt-5', 'fallback'],
      ['mock:gemini-2.5-pro', 'fallback'],
    ]);
    // Simulated models keep the real prices so cost dashboards stay meaningful.
    expect(plan.candidates[0]!.model.inputUsdPerMTok).toBe(2);
  });

  it('puts the budget model first when the team is over its soft limit', async () => {
    ctx = await createTestContext();
    const plan = await ctx.services.router.plan('chat', 'soft');
    expect(plan.candidates[0]).toMatchObject({
      reason: 'budget_downgrade',
      model: { modelName: 'claude-haiku-4-5' },
    });
    expect(plan.candidates[1]).toMatchObject({
      reason: 'fallback',
      model: { modelName: 'claude-sonnet-5-5' },
    });
  });

  it('uses configured providers and appends a simulated primary as last resort', async () => {
    ctx = await createTestContext({ providers: [new ScriptedProvider('anthropic', () => text('hi'))] });
    const plan = await ctx.services.router.plan('chat', 'ok');
    expect(plan.candidates.map((c) => [c.model.id, c.reason])).toEqual([
      ['anthropic:claude-sonnet-5-5', 'primary'],
      ['mock:claude-sonnet-5-5', 'mock_fallback'],
    ]);
    expect(plan.skipped).toEqual([
      { model: 'openai:gpt-5', why: 'unconfigured' },
      { model: 'google:gemini-2.5-pro', why: 'unconfigured' },
    ]);
  });

  it('only uses real models when mock fallback is off', async () => {
    ctx = await createTestContext({ env: { LLM_MOCK_FALLBACK: 'false' } });
    const plan = await ctx.services.router.plan('chat', 'ok');
    expect(plan.candidates).toEqual([]);
  });

  it('skips models whose circuit is open', async () => {
    ctx = await createTestContext({ providers: [new ScriptedProvider('anthropic', () => text('hi'))] });
    for (let i = 0; i < 3; i++) ctx.services.breaker.recordFailure('anthropic:claude-sonnet-5-5');
    const plan = await ctx.services.router.plan('chat', 'ok');
    // Nothing real is left, so the whole chain is simulated.
    expect(plan.candidates.map((c) => c.model.id)).toEqual([
      'mock:claude-sonnet-5-5',
      'mock:gpt-5',
      'mock:gemini-2.5-pro',
    ]);
    expect(plan.skipped).toContainEqual({ model: 'anthropic:claude-sonnet-5-5', why: 'circuit_open' });
  });

  it('rejects unknown task types', async () => {
    ctx = await createTestContext();
    await expect(ctx.services.router.plan('poetry', 'ok')).rejects.toMatchObject({
      code: 'unknown_task_type',
    });
  });
});

describe('CircuitBreaker', () => {
  it('opens after the threshold and half-opens after the cooldown', () => {
    let now = 0;
    const b = new CircuitBreaker(3, 1000, () => now);
    b.recordFailure('m');
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(false);
    b.recordFailure('m');
    expect(b.isOpen('m')).toBe(true);
    now = 1000;
    expect(b.isOpen('m')).toBe(false);
    b.recordSuccess('m');
    expect(b.isOpen('m')).toBe(false);
  });
});

describe('LlmService.call', () => {
  const call = (c: TestContext, extra: Record<string, unknown> = {}) =>
    c.services.llm.call({
      teamId: '',
      taskType: 'chat',
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      step: 1,
      ...extra,
    } as never);

  async function teamId(c: TestContext) {
    const res = await c.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${c.config.SEED_SALES_API_KEY}` },
    });
    return res.json().team.id as string;
  }

  it('retries a transient error once on the same model, then falls back', async () => {
    const anthropic = new ScriptedProvider(
      'anthropic',
      () => new ProviderError('overloaded', 'provider_unavailable', true, 529),
    );
    const openai = new ScriptedProvider('openai', () => text('from openai', 1000, 100));
    ctx = await createTestContext({ providers: [anthropic, openai] });
    const id = await teamId(ctx);
    const res = await call(ctx, { teamId: id });
    expect(res.model.id).toBe('openai:gpt-5');
    expect(res.routingReason).toBe('fallback');
    expect(res.attempts).toBe(3);
    expect(anthropic.requests).toHaveLength(2);
    // 1000 in × $1.25/M + 100 out × $10/M
    expect(res.costUsd).toBeCloseTo(0.00225, 6);

    const rows = await ctx.handle.pool.query(
      'select model, attempt, status, error_code, cost_usd from llm_calls order by attempt',
    );
    expect(rows.rows.map((r) => [r.model, r.attempt, r.status, r.error_code])).toEqual([
      ['anthropic:claude-sonnet-5-5', 1, 'error', 'provider_unavailable'],
      ['anthropic:claude-sonnet-5-5', 2, 'error', 'provider_unavailable'],
      ['openai:gpt-5', 3, 'ok', null],
    ]);
    const held = await ctx.handle.pool.query('select count(*)::int as n from budget_reservations');
    expect(held.rows[0].n).toBe(0);
  });

  it('does not retry non-retryable errors on the same model', async () => {
    const anthropic = new ScriptedProvider(
      'anthropic',
      () => new ProviderError('bad request', 'http_400', false, 400),
    );
    ctx = await createTestContext({ providers: [anthropic] });
    const res = await call(ctx, { teamId: await teamId(ctx) });
    expect(anthropic.requests).toHaveLength(1);
    expect(res.routingReason).toBe('mock_fallback');
  });

  it('returns 502 when every candidate fails', async () => {
    ctx = await createTestContext();
    await expect(
      call(ctx, { teamId: await teamId(ctx), faultModel: 'claude-sonnet-5-5,gpt-5,gemini-2.5-pro' }),
    ).rejects.toMatchObject({
      status: 502,
      code: 'upstream_unavailable',
    });
  });
});
