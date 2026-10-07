import { ContactResponse, ListContactsResponse, ListDealsResponse } from '@agentops/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, login } from './helpers.js';

describe('contacts and deals', () => {
  let app: INestApplication;
  let auth: { authorization: string };

  beforeAll(async () => {
    app = await bootApp();
    auth = { authorization: `Bearer ${await login(app)}` };
  });
  afterAll(() => app.close());

  const api = () => request(app.getHttpServer());

  it('lists contacts with open pipeline totals', async () => {
    const res = await api().get('/contacts').set(auth);
    expect(res.status).toBe(200);
    const { contacts } = ListContactsResponse.parse(res.body);
    expect(contacts).toHaveLength(20);
    const maya = contacts.find((c) => c.name === 'Maya Chen');
    expect(maya).toMatchObject({ id: 1, openDeals: 1, pipelineUsd: 48000 });
  });

  it('searches by name, company or email (case-insensitive, wildcards escaped)', async () => {
    const byCompany = await api().get('/contacts').query({ q: 'northwind' }).set(auth);
    expect(byCompany.body.contacts.map((c: { name: string }) => c.name)).toEqual(['Maya Chen']);
    const wildcard = await api().get('/contacts').query({ q: '%' }).set(auth);
    expect(wildcard.body.contacts).toHaveLength(0);
  });

  it('returns contact detail with deals and the 10 most recent notes, newest first', async () => {
    const res = await api().get('/contacts/1').set(auth);
    expect(res.status).toBe(200);
    const { contact } = ContactResponse.parse(res.body);
    expect(contact.company).toBe('Northwind Logistics');
    expect(contact.deals[0]).toMatchObject({ stage: 'lead', valueUsd: 48000 });
    expect(contact.notes.length).toBeGreaterThanOrEqual(2);
    const times = contact.notes.map((n) => Date.parse(n.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('returns 404 / 400 for missing or malformed ids', async () => {
    const missing = await api().get('/contacts/9999').set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    expect((await api().get('/contacts/abc').set(auth)).status).toBe(400);
  });

  it('creates and updates a contact, rejecting duplicate emails', async () => {
    const created = await api()
      .post('/contacts')
      .set(auth)
      .send({ name: 'Zoe Park', email: 'Zoe@Example.com', company: 'Example Co' });
    expect(created.status).toBe(201);
    expect(created.body.contact).toMatchObject({ email: 'zoe@example.com', deals: [], notes: [] });

    const dup = await api()
      .post('/contacts')
      .set(auth)
      .send({ name: 'Zoe Again', email: 'zoe@example.com', company: 'Other' });
    expect(dup.status).toBe(409);

    const patched = await api()
      .patch(`/contacts/${created.body.contact.id}`)
      .set(auth)
      .send({ title: 'CTO' });
    expect(patched.status).toBe(200);
    expect(patched.body.contact.title).toBe('CTO');

    const bad = await api().post('/contacts').set(auth).send({ name: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('adds a note authored by the signed-in user', async () => {
    const res = await api().post('/contacts/2/notes').set(auth).send({ body: 'Called Daniel.' });
    expect(res.status).toBe(201);
    expect(res.body.note).toMatchObject({ contactId: 2, author: 'Ada Admin', body: 'Called Daniel.' });
  });

  it('lists deals with contact names, filters by stage, and moves stages', async () => {
    const all = await api().get('/deals').set(auth);
    const { deals } = ListDealsResponse.parse(all.body);
    expect(deals.length).toBe(25);
    const won = await api().get('/deals').query({ stage: 'won' }).set(auth);
    expect(won.body.deals.every((d: { stage: string }) => d.stage === 'won')).toBe(true);
    expect((await api().get('/deals').query({ stage: 'nope' }).set(auth)).status).toBe(400);

    const moved = await api().patch('/deals/1').set(auth).send({ stage: 'qualified' });
    expect(moved.status).toBe(200);
    expect(moved.body.deal).toMatchObject({ id: 1, stage: 'qualified' });
  });
});
