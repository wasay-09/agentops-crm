import { loadConfig } from '../config.js';
import { createDb, createPool } from './client.js';
import { resetAndSeed, seedIfEmpty } from './seed.js';

const pool = createPool(loadConfig().databaseUrl);
const db = createDb(pool);
try {
  if (process.argv.includes('--reset')) {
    await resetAndSeed(db);
    console.log('crm: database reset and seeded');
  } else {
    const seeded = await seedIfEmpty(db);
    console.log(seeded ? 'crm: seeded demo data' : 'crm: data already present, skipping seed (use --reset)');
  }
} finally {
  await pool.end();
}
