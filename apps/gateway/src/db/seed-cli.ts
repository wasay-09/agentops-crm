import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { seed } from './seed.js';

const config = loadConfig();
const handle = createDb(config.DATABASE_URL, 1);
await seed(handle.db, config);
await handle.close();
console.log('seed complete');
