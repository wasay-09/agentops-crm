import { loadConfig } from '../config.js';
import { runMigrations } from './migrate.js';

const { databaseUrl } = loadConfig();
await runMigrations(databaseUrl);
console.log('crm: migrations applied');
