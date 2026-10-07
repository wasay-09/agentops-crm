import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';

/** Builds the Nest app with the same settings in production and tests. */
export async function createApp(config: AppConfig, logger = true): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: logger ? ['log', 'warn', 'error'] : false,
    cors: { origin: config.corsOrigin, credentials: true },
  });
  app.enableShutdownHooks();
  return app;
}
