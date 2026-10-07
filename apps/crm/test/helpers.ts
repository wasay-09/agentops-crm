import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory.js';
import { loadConfig } from '../src/config.js';
import { createDb, createPool } from '../src/db/client.js';
import { resetAndSeed } from '../src/db/seed.js';

export const TOOL_TOKEN = 'test-tool-token';

/** Fresh seeded data + a booted app for one test file. */
export async function bootApp(): Promise<INestApplication> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    await resetAndSeed(createDb(pool));
  } finally {
    await pool.end();
  }
  const app = await createApp(config, false);
  await app.init();
  return app;
}

export async function login(app: INestApplication, email = 'admin@acme.test'): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}
