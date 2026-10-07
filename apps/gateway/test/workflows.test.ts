import { afterEach, describe, expect, it } from 'vitest';
import { auth, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
afterEach(async () => ctx?.close());

const start = (c: TestContext, contactId: number) =>
  c.app.inject({
    method: 'POST',
    url: '/v1/workflows/lead-follow-up/runs',
    headers: auth(),
    payload: { input: { contactId }, actor: 'rep@acme.test' },
  });

describe('lead-follow-up workflow', () => {
  it('summarises, drafts, waits for approval, then logs the email and advances the lead', async () => {
    ctx = await createTestContext();
    const wf = (await start(ctx, 1)).json();
    expect(wf.status).toBe('awaiting_approval');
    expect(wf.steps.map((s: { id: string; status: string }) => `${s.id}:${s.status}`)).toEqual([
      'lookup:completed',
      'summarize:completed',
      'draft:completed',
      'approve:waiting',
      'log:pending',
      'advance:pending',
    ]);
    expect(wf.context.summary).toContain('Who: Maya Chen');
    expect(wf.context.draft).toMatch(/^Subject: /);
    expect(ctx.crm.notes.filter((n) => n.contactId === 1)).toHaveLength(1); // nothing written before approval

    const approvalId = wf.steps.find((s: { id: string }) => s.id === 'approve').approvalId;
    const decided = (
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/approvals/${approvalId}`,
        headers: auth(),
        payload: { decision: 'approve', decidedBy: 'ada@acme.test' },
      })
    ).json();
    expect(decided.workflowRun.status).toBe('completed');
    expect(decided.workflowRun.steps.map((s: { status: string }) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
    expect(ctx.crm.notes.at(-1)).toMatchObject({
      contactId: 1,
      author: 'AI agent (approved by ada@acme.test)',
    });
    expect(ctx.crm.deals.find((d) => d.id === 1)!.stage).toBe('qualified');

    // Agent steps are linked runs with their own ledger rows.
    const runs = (await ctx.app.inject({ method: 'GET', url: '/v1/runs', headers: auth() })).json().runs;
    expect(
      runs
        .filter((r: { workflowRunId: string }) => r.workflowRunId === wf.id)
        .map((r: { agent: string }) => r.agent)
        .sort(),
    ).toEqual(['email-drafter', 'lead-summarizer']);
  });

  it('skips the stage change when there is no open lead deal', async () => {
    ctx = await createTestContext();
    const wf = (await start(ctx, 2)).json();
    const approvalId = wf.steps.find((s: { id: string }) => s.id === 'approve').approvalId;
    const done = (
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/approvals/${approvalId}`,
        headers: auth(),
        payload: { decision: 'approve', decidedBy: 'ada' },
      })
    ).json().workflowRun;
    expect(done.steps.at(-1).status).toBe('skipped');
    expect(ctx.crm.deals.find((d) => d.id === 2)!.stage).toBe('qualified');
  });

  it('is cancelled when the email is rejected', async () => {
    ctx = await createTestContext();
    const wf = (await start(ctx, 1)).json();
    const approvalId = wf.steps.find((s: { id: string }) => s.id === 'approve').approvalId;
    const done = (
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/approvals/${approvalId}`,
        headers: auth(),
        payload: { decision: 'reject', decidedBy: 'ada', note: 'too pushy' },
      })
    ).json().workflowRun;
    expect(done.status).toBe('cancelled');
    expect(done.steps.slice(4).map((s: { status: string }) => s.status)).toEqual(['skipped', 'skipped']);
    expect(ctx.crm.calls.some((c) => c.name === 'add_note')).toBe(false);
  });

  it('fails cleanly when a CRM step fails', async () => {
    ctx = await createTestContext();
    ctx.crm.failing.add('get_contact');
    const wf = (await start(ctx, 1)).json();
    expect(wf).toMatchObject({ status: 'failed', error: 'Load contact from CRM failed: crm_unavailable' });
  });

  it('validates input and unknown workflows', async () => {
    ctx = await createTestContext();
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/workflows/lead-follow-up/runs',
          headers: auth(),
          payload: { input: {} },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/v1/workflows/nope/runs',
          headers: auth(),
          payload: { input: {} },
        })
      ).statusCode,
    ).toBe(404);
  });
});
