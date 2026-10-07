import { startTracing } from './tracing.js';

// Tracing must start before the app modules (and therefore http/express) are imported.
await startTracing();
const { bootstrap } = await import('./bootstrap.js');
await bootstrap();
