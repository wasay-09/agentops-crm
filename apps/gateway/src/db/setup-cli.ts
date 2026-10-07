import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { ensureDatabase, runMigrations } from './migrate.js';
import { seed } from './seed.js';

const config = loadConfig();
await ensureDatabase(config.DATABASE_URL);
const handle = createDb(config.DATABASE_URL, 1);
await runMigrations(handle.db);
await seed(handle.db, config);
await handle.close();
console.log(`database ready: ${new URL(config.DATABASE_URL).pathname.slice(1)}`);
