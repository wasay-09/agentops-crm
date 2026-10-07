import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory.js';
import { loadConfig } from './config.js';
import { createDb, createPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedIfEmpty } from './db/seed.js';

export async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  if (config.runMigrations) {
    await runMigrations(config.databaseUrl);
    logger.log('Migrations applied');
  }
  if (config.seedOnStart) {
    const pool = createPool(config.databaseUrl);
    try {
      if (await seedIfEmpty(createDb(pool))) logger.log('Seeded demo data');
    } finally {
      await pool.end();
    }
  }

  const app = await createApp(config);
  await app.listen(config.port, '0.0.0.0');
  logger.log(`CRM listening on :${config.port}`);
}
