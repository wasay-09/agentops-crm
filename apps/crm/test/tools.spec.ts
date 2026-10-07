import { TOOL_CONTRACTS, ToolResponse } from '@agentops/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, login, TOOL_TOKEN } from './helpers.js';

describe('agent tool API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(() => app.close());

  const call = (name: string, args: unknown, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post(`/tools/${name}`)
      .set({ authorization: `Bearer ${TOOL_TOKEN}`, ...headers })
      .send(args as object);

  /** Asserts a success envelope and validates data against the tool's result contract. */
  const ok = async (name: keyof typeof TOOL_CONTRACTS, args: unknown, headers?: Record<string, string>) => {
    const res = await call(name, args, headers);
    expect(res.status).toBe(200);
    const env = ToolResponse.parse(res.body);
    if (!env.ok) throw new Error(env.error.message);
    return TOOL_CONTRACTS[name].result.parse(env.data) as never;
  };

  it('requires the service token (a user JWT is not enough)', async () => {
    const none = await request(app.getHttpServer()).post('/tools/search_contacts').send({ query: 'maya' });
    expect(none.status).toBe(401);
    expect(none.body).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid tool token' } });

    const jwt = await login(app);
    const userToken = await request(app.getHttpServer())
      .post('/tools/search_contacts')
      .set('authorization', `Bearer ${jwt}`)
      .send({ query: 'maya' });
    expect(userToken.status).toBe(401);
  });

  it('serves a manifest with JSON schemas', async () => {
    const res = await request(app.getHttpServer()).get('/tools').set('authorization', `Bearer ${TOOL_TOKEN}`);
    expect(res.status).toBe(200);
    const names = res.body.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(Object.keys(TOOL_CONTRACTS));
    const addNote = res.body.tools.find((t: { name: string }) => t.name === 'add_note');
    expect(addNote.mode).toBe('write');
    expect(addNote.inputSchema.required).toEqual(['contactId', 'body']);
  });

  it('search_contacts matches name/company/email with a default limit of 5', async () => {
    const { contacts } = await ok('search_contacts', { query: 'MAYA' });
    expect(contacts).toEqual([
      {
        id: 1,
        name: 'Maya Chen',
        email: 'maya.chen@northwindlogistics.com',
        company: 'Northwind Logistics',
        title: 'VP Operations',
      },
    ]);
    const many = (await ok('search_contacts', { query: 'a' })) as { contacts: unknown[] };
    expect(many.contacts).toHaveLength(5);
    const two = (await ok('search_contacts', { query: 'a', limit: 2 })) as { contacts: unknown[] };
    expect(two.contacts).toHaveLength(2);
  });

  it('get_contact returns detail; unknown id is not_found', async () => {
    const { contact } = await ok('get_contact', { contactId: 1 });
    expect((contact as { name: string }).name).toBe('Maya Chen');

    const res = await call('get_contact', { contactId: 999 });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('list_deals filters by stage and contact', async () => {
    const { deals } = (await ok('list_deals', { stage: 'proposal' })) as { deals: Array<{ stage: string }> };
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d) => d.stage === 'proposal')).toBe(true);
    const forContact = (await ok('list_deals', { contactId: 3 })) as { deals: Array<{ contactId: number }> };
    expect(forContact.deals).toHaveLength(2);
    expect(forContact.deals[0]).not.toHaveProperty('contactName');
  });

  it('add_note credits the approving actor when the gateway sends one', async () => {
    const approved = (await ok(
      'add_note',
      { contactId: 1, body: 'Call Maya next week.' },
      { 'x-agentops-actor': 'admin@acme.test' },
    )) as { note: { author: string } };
    expect(approved.note.author).toBe('AI agent (approved by admin@acme.test)');

    const anonymous = (await ok('add_note', { contactId: 1, body: 'Auto note' })) as {
      note: { author: string };
    };
    expect(anonymous.note.author).toBe('AI agent');

    const missing = await call('add_note', { contactId: 999, body: 'x' });
    expect(missing.status).toBe(404);
  });

  it('move_deal_stage updates the stage', async () => {
    const { deal } = (await ok('move_deal_stage', { dealId: 1, stage: 'qualified' })) as {
      deal: { stage: string };
    };
    expect(deal.stage).toBe('qualified');
    const missing = await call('move_deal_stage', { dealId: 999, stage: 'won' });
    expect(missing.body.error.code).toBe('not_found');
  });

  it('rejects invalid args and unknown tools with the envelope', async () => {
    const bad = await call('move_deal_stage', { dealId: 1, stage: 'closed' });
    expect(bad.status).toBe(400);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error.code).toBe('invalid_args');
    expect(bad.body.error.message).toContain('stage');

    const extra = await call('get_contact', { contactId: 1, sql: 'drop table' });
    expect(extra.status).toBe(400);

    const unknown = await call('delete_contact', { contactId: 1 });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('unknown_tool');
  });
});
