import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const handle = createDb(config.DATABASE_URL, 1);
await runMigrations(handle.db);
await handle.close();
console.log('migrations applied');
