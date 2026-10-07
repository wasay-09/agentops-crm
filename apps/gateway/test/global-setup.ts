import { createDb } from '../src/db/client.js';
import { ensureDatabase, runMigrations } from '../src/db/migrate.js';

export const TEST_DATABASE_URL =
  process.env.GATEWAY_TEST_DATABASE_URL ?? 'postgres://localhost:5432/agentops_gateway_test';

export default async function setup() {
  await ensureDatabase(TEST_DATABASE_URL);
  const handle = createDb(TEST_DATABASE_URL, 1);
  await runMigrations(handle.db);
  await handle.close();
}
