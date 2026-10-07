import { ensureDatabase, runMigrations } from '../src/db/migrate.js';

export default async function setup(): Promise<void> {
  const url = process.env.CRM_TEST_DATABASE_URL ?? 'postgres://localhost:5432/agentops_crm_test';
  await ensureDatabase(url);
  await runMigrations(url);
}
