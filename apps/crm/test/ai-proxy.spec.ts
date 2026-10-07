import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootApp, login } from './helpers.js';

interface Captured {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

/** Minimal fake gateway: records requests and answers from a route table. */
function fakeGateway() {
  const calls: Captured[] = [];
  let reply: (c: Captured) => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true } });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      const captured = {
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      calls.push(captured);
      const { status, body } = reply(captured);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return {
    calls,
    server,
    setReply: (fn: typeof reply) => {
      reply = fn;
    },
  };
}

describe('AI proxy', () => {
  const gw = fakeGateway();
  let app: INestApplication;
  let admin: { authorization: string };
  let rep: { authorization: string };

  beforeAll(async () => {
    await new Promise<void>((r) => gw.server.listen(0, '127.0.0.1', r));
    process.env.GATEWAY_URL = `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
    app = await bootApp();
    admin = { authorization: `Bearer ${await login(app, 'admin@acme.test')}` };
    rep = { authorization: `Bearer ${await login(app, 'rep@acme.test')}` };
  });
  afterAll(async () => {
    await app.close();
    await new Promise((r) => gw.server.close(r));
  });
  beforeEach(() => {
    gw.calls.length = 0;
    gw.setReply(() => ({ status: 200, body: { ok: true } }));
  });

  const api = () => request(app.getHttpServer());

  it('requires a CRM session', async () => {
    expect((await api().post('/ai/ask').send({ question: 'hi' })).status).toBe(401);
    expect(gw.calls).toHaveLength(0);
  });

  it('ask → POST /v1/runs with agent, context, actor, team key and idempotency key', async () => {
    gw.setReply(() => ({ status: 201, body: { id: 'run_1', status: 'completed' } }));
    const res = await api()
      .post('/ai/ask')
      .set({ ...rep, 'idempotency-key': 'idem-123' })
      .send({ question: 'Summarise this lead', contactId: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'run_1', status: 'completed' });

    const [call] = gw.calls;
    expect(call).toMatchObject({ method: 'POST', url: '/v1/runs' });
    expect(call!.body).toEqual({
      agent: 'crm-assistant',
      input: 'Summarise this lead',
      context: { contactId: 1 },
      actor: 'rep@acme.test',
    });
    expect(call!.headers.authorization).toBe('Bearer ak_test_team');
    expect(call!.headers['idempotency-key']).toBe('idem-123');
  });

  it('omits context when no contact is given, and validates the body locally', async () => {
    await api().post('/ai/ask').set(rep).send({ question: 'Who is in proposal?' });
    expect(gw.calls[0]!.body).toEqual({
      agent: 'crm-assistant',
      input: 'Who is in proposal?',
      actor: 'rep@acme.test',
    });

    const bad = await api().post('/ai/ask').set(rep).send({ question: '' });
    expect(bad.status).toBe(400);
    expect(gw.calls).toHaveLength(1);
  });

  it('follow-up → starts the lead-follow-up workflow', async () => {
    await api().post('/ai/follow-up').set(rep).send({ contactId: 1 });
    expect(gw.calls[0]).toMatchObject({
      method: 'POST',
      url: '/v1/workflows/lead-follow-up/runs',
      body: { input: { contactId: 1 }, actor: 'rep@acme.test' },
    });
  });

  it('passes through query strings and read routes', async () => {
    await api().get('/ai/runs').query({ status: 'completed', limit: '5' }).set(rep);
    await api().get('/ai/runs/run_9').set(rep);
    await api().get('/ai/workflow-runs/wf_1').set(rep);
    await api().get('/ai/approvals').query({ status: 'pending' }).set(rep);
    await api().get('/ai/usage').query({ days: '14' }).set(rep);
    expect(gw.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/runs?status=completed&limit=5',
      'GET /v1/runs/run_9',
      'GET /v1/workflows/runs/wf_1',
      'GET /v1/approvals?status=pending',
      'GET /v1/usage/summary?days=14',
    ]);
  });

  it('approval decisions take decidedBy from the session, not the client', async () => {
    await api()
      .post('/ai/approvals/apr_1')
      .set(rep)
      .send({ decision: 'approve', note: 'looks good', decidedBy: 'someone-else@evil.test' });
    expect(gw.calls[0]).toMatchObject({
      url: '/v1/approvals/apr_1',
      body: { decision: 'approve', note: 'looks good', decidedBy: 'rep@acme.test' },
    });
  });

  it('passes gateway error statuses and bodies through', async () => {
    const body = { error: { code: 'budget_exceeded', message: 'Monthly budget reached' } };
    gw.setReply(() => ({ status: 402, body }));
    const res = await api().post('/ai/ask').set(rep).send({ question: 'hi' });
    expect(res.status).toBe(402);
    expect(res.body).toEqual(body);
  });

  it('admin routes require the admin role and use the admin key', async () => {
    const denied = await api().get('/ai/admin/prompts').set(rep);
    expect(denied.status).toBe(403);
    expect(gw.calls).toHaveLength(0);

    await api().get('/ai/admin/prompts').set(admin);
    expect(gw.calls[0]!.headers.authorization).toBe('Bearer ak_test_admin');

    await api().post('/ai/admin/prompts/crm-assistant/versions').set(admin).send({ template: 'Hi {{name}}' });
    expect(gw.calls[1]).toMatchObject({
      url: '/v1/admin/prompts/crm-assistant/versions',
      body: { template: 'Hi {{name}}', createdBy: 'admin@acme.test' },
    });

    await api()
      .put('/ai/admin/prompts/crm-assistant/deployment')
      .set(admin)
      .send({ weights: [{ version: 1, weight: 100 }] });
    expect(gw.calls[2]).toMatchObject({
      method: 'PUT',
      body: { weights: [{ version: 1, weight: 100 }], updatedBy: 'admin@acme.test' },
    });

    const badWeights = await api()
      .put('/ai/admin/prompts/crm-assistant/deployment')
      .set(admin)
      .send({ weights: [{ version: 1, weight: 50 }] });
    expect(badWeights.status).toBe(400);
    expect((await api().put('/ai/admin/routing/nope').set(admin).send({})).status).toBe(400);
  });

  it('budget update resolves the team via /v1/me then uses the admin key', async () => {
    gw.setReply((c) =>
      c.url === '/v1/me'
        ? { status: 200, body: { team: { id: 'team_sales', name: 'Sales' }, scopes: ['runs'] } }
        : { status: 200, body: { id: 'team_sales', monthlyBudgetUsd: 5 } },
    );
    const res = await api().put('/ai/admin/budget').set(admin).send({ monthlyBudgetUsd: 5 });
    expect(res.status).toBe(200);
    expect(gw.calls.map((c) => [c.method, c.url, c.headers.authorization])).toEqual([
      ['GET', '/v1/me', 'Bearer ak_test_team'],
      ['PUT', '/v1/admin/teams/team_sales/budget', 'Bearer ak_test_admin'],
    ]);
    expect(gw.calls[1]!.body).toEqual({ monthlyBudgetUsd: 5 });
  });

  it('returns 502 gateway_unavailable when the gateway is down', async () => {
    const port = (gw.server.address() as AddressInfo).port;
    await new Promise((r) => gw.server.close(r));
    try {
      const res = await api().post('/ai/ask').set(rep).send({ question: 'hi' });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('gateway_unavailable');
    } finally {
      await new Promise<void>((r) => gw.server.listen(port, '127.0.0.1', r));
    }
  });
});
