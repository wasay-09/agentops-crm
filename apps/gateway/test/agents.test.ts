import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/types.js';
import {
  ADMIN_KEY,
  auth,
  createTestContext,
  ScriptedProvider,
  type TestContext,
  text,
  toolUse,
} from './helpers.js';

let ctx: TestContext;
afterEach(async () => ctx?.close());

const startRun = (c: TestContext, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  c.app.inject({
    method: 'POST',
    url: '/v1/runs',
    headers: { ...auth(), ...headers },
    payload: { agent: 'crm-assistant', ...payload },
  });

const decide = (c: TestContext, id: string, decision: 'approve' | 'reject', note?: string) =>
  c.app.inject({
    method: 'POST',
    url: `/v1/approvals/${id}`,
    headers: auth(),
    payload: { decision, decidedBy: 'ada@acme.test', note },
  });

describe('agent runs (mock provider)', () => {
  it('runs read tools immediately and answers from their results', async () => {
    ctx = await createTestContext();
    const res = await startRun(ctx, { input: 'Summarise this lead', context: { contactId: 1 } });
    expect(res.statusCode).toBe(201);
    const run = res.json();
    expect(run.status).toBe('completed');
    expect(run.output).toContain('Maya Chen');
    expect(run.toolCalls.map((t: { toolName: string; status: string }) => [t.toolName, t.status])).toEqual([
      ['get_contact', 'executed'],
    ]);
    expect(run.llmCalls).toHaveLength(2);
    expect(run.totalCostUsd).toBeGreaterThan(0);
    expect(run.timeline.map((e: { kind: string }) => e.kind)).toEqual(['llm', 'tool', 'llm']);
  });

  it('pauses write tools for approval, then resumes and completes after approval', async () => {
    ctx = await createTestContext();
    const run = (
      await startRun(ctx, {
        input: 'Add a note that we should call next week',
        context: { contactId: 1 },
        actor: 'rep@acme.test',
      })
    ).json();
    expect(run.status).toBe('awaiting_approval');
    expect(run.output).toContain('waiting for approval');
    expect(ctx.crm.calls.map((c) => c.name)).toEqual(['get_contact']); // nothing written yet

    const approvals = (await ctx.app.inject({ method: 'GET', url: '/v1/approvals', headers: auth() })).json()
      .approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      kind: 'tool_call',
      title: 'Add note to contact #1',
      payload: { tool: 'add_note', args: { contactId: 1, body: 'We should call next week' } },
      requestedBy: 'rep@acme.test',
    });

    const decided = (await decide(ctx, approvals[0].id, 'approve')).json();
    expect(decided.approval).toMatchObject({ status: 'approved', decidedBy: 'ada@acme.test' });
    expect(decided.run.status).toBe('completed');
    expect(decided.run.output).toContain('approved and saved');
    expect(ctx.crm.notes.at(-1)).toMatchObject({
      body: 'We should call next week',
      author: 'AI agent (approved by ada@acme.test)',
    });
  });

  it('feeds a rejection back to the model without performing the write', async () => {
    ctx = await createTestContext();
    const run = (
      await startRun(ctx, { input: 'Add a note that the deal is lost', context: { contactId: 1 } })
    ).json();
    const decided = (await decide(ctx, run.approvals[0].id, 'reject', 'Not true')).json();
    expect(decided.run.status).toBe('completed');
    expect(decided.run.output).toContain('rejected');
    expect(decided.run.toolCalls.find((t: { toolName: string }) => t.toolName === 'add_note').status).toBe(
      'rejected',
    );
    expect(ctx.crm.notes.some((n) => n.body.includes('lost'))).toBe(false);
  });

  it('records each decision exactly once', async () => {
    ctx = await createTestContext();
    const run = (
      await startRun(ctx, { input: 'Add a note: renewal call booked', context: { contactId: 1 } })
    ).json();
    const id = run.approvals[0].id;
    const [a, b] = await Promise.all([decide(ctx, id, 'approve'), decide(ctx, id, 'approve')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(ctx.crm.notes.filter((n) => /renewal/i.test(n.body)).length).toBe(1);
  });

  it('replays the stored run for a repeated Idempotency-Key instead of re-running it', async () => {
    ctx = await createTestContext();
    const headers = { 'idempotency-key': 'req-0000000001' };
    const first = (await startRun(ctx, { input: 'Find Sofia' }, headers)).json();
    const second = (await startRun(ctx, { input: 'Find Sofia' }, headers)).json();
    expect(second.id).toBe(first.id);
    const { rows } = await ctx.handle.pool.query('select count(*)::int as n from llm_calls');
    expect(rows[0].n).toBe(first.llmCalls.length);
  });

  it('does not act on instructions embedded in CRM data', async () => {
    ctx = await createTestContext();
    const run = (await startRun(ctx, { input: 'Summarise this lead', context: { contactId: 3 } })).json();
    expect(run.status).toBe('completed');
    expect(run.approvals).toHaveLength(0);
    expect(ctx.crm.calls.every((c) => c.name === 'get_contact')).toBe(true);
  });

  it('returns 404 for unknown or disabled agents', async () => {
    ctx = await createTestContext();
    expect((await startRun(ctx, { agent: 'nope', input: 'hi' })).statusCode).toBe(404);
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/agents/crm-assistant',
      headers: auth(ADMIN_KEY),
      payload: { enabled: false },
    });
    expect((await startRun(ctx, { input: 'hi' })).json().error.code).toBe('unknown_agent');
  });
});

describe('agent runs (scripted provider)', () => {
  it('reports invalid tool arguments back to the model so it can correct itself', async () => {
    const provider = new ScriptedProvider('anthropic', (_req, n) =>
      n === 1
        ? toolUse('get_contact', { contactId: 'one' })
        : n === 2
          ? toolUse('get_contact', { contactId: 1 }, 'tc2')
          : text('Maya Chen, VP Operations.'),
    );
    ctx = await createTestContext({ providers: [provider] });
    const run = (await startRun(ctx, { input: 'Who is contact one?' })).json();
    expect(run.status).toBe('completed');
    expect(run.toolCalls.map((t: { status: string }) => t.status)).toEqual(['invalid_args', 'executed']);
    const toolMsg = provider.requests[1]!.messages.at(-1)!;
    expect(toolMsg).toMatchObject({ role: 'tool', isError: true });
  });

  it('refuses tools the agent is not allowed to use', async () => {
    const provider = new ScriptedProvider('anthropic', (_req, n) =>
      n === 1 ? toolUse('add_note', { contactId: 1, body: 'x' }) : text('ok'),
    );
    ctx = await createTestContext({ providers: [provider] });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: auth(),
      payload: { agent: 'lead-summarizer', input: 'brief', context: { contactId: 1 } },
    });
    const run = res.json();
    expect(run.status).toBe('completed');
    expect(run.toolCalls[0]).toMatchObject({ toolName: 'add_note', status: 'failed' });
    expect(run.approvals).toHaveLength(0);
  });

  it('fails the run after max steps', async () => {
    const provider = new ScriptedProvider('anthropic', (_req, n) =>
      toolUse('search_contacts', { query: 'a' }, `tc${n}`),
    );
    ctx = await createTestContext({ providers: [provider] });
    const run = (await startRun(ctx, { input: 'loop forever' })).json();
    expect(run).toMatchObject({ status: 'failed', error: 'max_steps_exceeded' });
    expect(run.llmCalls).toHaveLength(6);
  });

  it('marks refusals as failed runs', async () => {
    const provider = new ScriptedProvider('anthropic', () => ({
      ...text('I cannot help with that.'),
      stopReason: 'refusal',
    }));
    ctx = await createTestContext({ providers: [provider] });
    const run = (await startRun(ctx, { input: 'something' })).json();
    expect(run).toMatchObject({ status: 'failed', error: 'refused' });
  });

  it('strips leaked tool-call markup from answers', async () => {
    const provider = new ScriptedProvider('anthropic', () =>
      text('Done.\n<tool_call>{"name":"add_note"}</tool_call>'),
    );
    ctx = await createTestContext({ providers: [provider] });
    const run = (await startRun(ctx, { input: 'hi' })).json();
    expect(run.output).toBe('Done.');
  });

  it('falls back to another model mid-run without losing the conversation', async () => {
    let calls = 0;
    const anthropic = new ScriptedProvider('anthropic', () => {
      calls += 1;
      return calls === 1
        ? toolUse('get_contact', { contactId: 1 })
        : new ProviderError('rate limited', 'rate_limited', true, 429);
    });
    ctx = await createTestContext({ providers: [anthropic] });
    const run = (await startRun(ctx, { input: 'Summarise this lead', context: { contactId: 1 } })).json();
    expect(run.status).toBe('completed');
    const models = run.llmCalls.map((c: { model: string; status: string }) => `${c.model}:${c.status}`);
    expect(models).toEqual([
      'anthropic:claude-sonnet-5-5:ok',
      'anthropic:claude-sonnet-5-5:error',
      'anthropic:claude-sonnet-5-5:error',
      'mock:claude-sonnet-5-5:ok',
    ]);
    expect(run.output).toContain('Maya Chen');
  });
});

describe('HTTP basics', () => {
  it('requires a valid API key', async () => {
    ctx = await createTestContext();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/runs' })).statusCode).toBe(401);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/runs', headers: { authorization: 'Bearer nope' } }))
        .statusCode,
    ).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('validates request bodies', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/runs',
      headers: auth(),
      payload: { agent: 'crm-assistant' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('scopes runs to the calling team', async () => {
    ctx = await createTestContext();
    const run = (await startRun(ctx, { input: 'Find Maya' })).json();
    const other = await ctx.app.inject({
      method: 'GET',
      url: `/v1/runs/${run.id}`,
      headers: auth(ADMIN_KEY),
    });
    expect(other.statusCode).toBe(404);
  });

  it('issues hashed API keys that work immediately', async () => {
    ctx = await createTestContext();
    const teams = (
      await ctx.app.inject({ method: 'GET', url: '/v1/admin/teams', headers: auth(ADMIN_KEY) })
    ).json().teams;
    const sales = teams.find((t: { name: string }) => t.name === 'sales');
    const created = (
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/admin/teams/${sales.id}/keys`,
        headers: auth(ADMIN_KEY),
        payload: { name: 'ci' },
      })
    ).json();
    expect(created.key).toMatch(/^ak_live_/);
    const { rows } = await ctx.handle.pool.query('select key_hash from api_keys where id = $1', [created.id]);
    expect(rows[0].key_hash).not.toContain(created.key);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth(created.key) })).json().team.name,
    ).toBe('sales');
  });
});
