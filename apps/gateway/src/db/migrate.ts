import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { Db } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Works from src/db (tsx) and dist/src/db (compiled). */
export const MIGRATIONS_DIR = path.resolve(
  here,
  here.includes(`${path.sep}dist${path.sep}`) ? '../../../drizzle' : '../../drizzle',
);

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/** Create the database named in `url` if it doesn't exist (local dev/test convenience). */
export async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (exists.rowCount === 0) await client.query(`create database "${dbName.replaceAll('"', '')}"`);
  } finally {
    await client.end();
  }
}
