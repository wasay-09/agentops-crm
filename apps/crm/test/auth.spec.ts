import { LoginResponse } from '@agentops/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, login } from './helpers.js';

describe('auth', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(() => app.close());

  it('logs in a seeded user and returns a token matching the contract', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@acme.test', password: 'password123' });
    expect(res.status).toBe(200);
    const body = LoginResponse.parse(res.body);
    expect(body.user).toMatchObject({ email: 'admin@acme.test', role: 'admin', name: 'Ada Admin' });
  });

  it('rejects a wrong password without revealing which part was wrong', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@acme.test', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');

    const unknown = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ghost@acme.test', password: 'nope' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(res.body.error.message);
  });

  it('validates the login body', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('guards routes with the JWT and returns the current user from /me', async () => {
    expect((await request(app.getHttpServer()).get('/me')).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).get('/contacts').set('authorization', 'Bearer junk')).status,
    ).toBe(401);

    const token = await login(app, 'rep@acme.test');
    const me = await request(app.getHttpServer()).get('/me').set('authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'rep@acme.test', role: 'rep' });
  });

  it('leaves /health public', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
