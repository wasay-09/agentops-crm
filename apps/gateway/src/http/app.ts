import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ZodError, type z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Services } from '../services.js';
import { ApiKeyAuth } from './auth.js';
import { adminRoutes } from './routes/admin.js';
import { coreRoutes } from './routes/core.js';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

/** `makeServices` receives the app's logger so services log through Fastify (with request ids). */
export async function buildApp(
  makeServices: (log: FastifyBaseLogger) => Services,
  opts: FastifyServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    bodyLimit: 512 * 1024,
    ...opts,
  });
  const services = makeServices(app.log);
  const auth = new ApiKeyAuth(services.db);
  app.decorate('services', services);
  app.decorateRequest('auth', null as never);

  if (services.config.CORS_ORIGIN)
    await app.register(cors, { origin: services.config.CORS_ORIGIN.split(',') });
  await app.register(rateLimit, {
    global: true,
    max: services.config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // Per API key, so one noisy integration can't starve the others.
    keyGenerator: (req) => req.headers.authorization ?? req.ip,
    allowList: (req) => req.url === '/health' || req.url === '/ready',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Rate limit exceeded; retry in ${Math.ceil(ctx.ttl / 1000)}s` },
    }),
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(err.status)
        .send({ error: { code: err.code, message: err.message, requestId: req.id } });
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return reply.status(400).send({ error: { code: 'invalid_request', message, requestId: req.id } });
    }
    const shaped = err as { statusCode?: number; error?: { code?: string; message?: string } };
    if (shaped.statusCode && shaped.error?.code) {
      return reply.status(shaped.statusCode).send({ error: { ...shaped.error, requestId: req.id } });
    }
    const status = shaped.statusCode;
    if (status && status < 500) {
      return reply.status(status).send({
        error: {
          code: status === 429 ? 'rate_limited' : 'bad_request',
          message: (err as Error).message,
          requestId: req.id,
        },
      });
    }
    // Never leak internals (provider messages, SQL) to clients; they are in the logs and the trace.
    req.log.error({ err }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong', requestId: req.id } });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_req, reply) => {
    try {
      await services.db.execute('select 1');
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  await app.register(
    async (v1) => {
      v1.addHook('onRequest', async (req) => {
        req.auth = await auth.authenticate(req.headers.authorization);
      });
      await v1.register(coreRoutes);
      await v1.register(adminRoutes, { prefix: '/admin', onKeyChange: () => auth.clear() });
    },
    { prefix: '/v1' },
  );

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}
