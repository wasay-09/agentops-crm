import { assertProductionSafe, loadConfig } from './config.js';
import { startTelemetry, stopTelemetry } from './telemetry.js';

const config = loadConfig();
assertProductionSafe(config);
// Start tracing before the rest of the app loads.
startTelemetry(config.OTEL_EXPORTER_OTLP_ENDPOINT);

const { createDb } = await import('./db/client.js');
const { runMigrations } = await import('./db/migrate.js');
const { seed } = await import('./db/seed.js');
const { buildApp } = await import('./http/app.js');
const { createServices } = await import('./services.js');

const handle = createDb(config.DATABASE_URL);
if (config.RUN_MIGRATIONS) await runMigrations(handle.db);
if (config.SEED_ON_START) await seed(handle.db, config);

const app = await buildApp((log) => createServices(config, handle.db, log), {
  logger: { level: config.LOG_LEVEL, redact: ['req.headers.authorization'] },
  trustProxy: true,
});

// Expired budget reservations (from crashed requests) are swept every minute.
const sweeper = setInterval(() => {
  app.services.budget.purgeExpired().catch((err) => app.log.warn({ err }, 'reservation sweep failed'));
}, 60_000);
sweeper.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(sweeper);
  await app.close();
  await handle.close();
  await stopTelemetry();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

const available = ['anthropic', 'openai', 'google'].filter((p) => app.services.providers.isAvailable(p));
app.log.info({ providers: available, mockFallback: config.LLM_MOCK_FALLBACK }, 'providers');
await app.listen({ port: config.PORT, host: config.HOST });
