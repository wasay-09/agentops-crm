import { loadConfig } from '../config.js';
import { createDb, createPool } from './client.js';
import { ensureDatabase, runMigrations } from './migrate.js';
import { seedIfEmpty } from './seed.js';

/** Create the database if missing, apply migrations, seed demo data if empty. */
const { databaseUrl } = loadConfig();
await ensureDatabase(databaseUrl);
await runMigrations(databaseUrl);
const pool = createPool(databaseUrl);
try {
  const seeded = await seedIfEmpty(createDb(pool));
  console.log(`crm: database ready${seeded ? ' (seeded demo data)' : ''}`);
} finally {
  await pool.end();
}
