import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AiModule } from './ai/ai.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { TraceRouteInterceptor } from './common/trace-route.interceptor.js';
import { ConfigModule } from './config.module.js';
import { ContactsModule } from './contacts/contacts.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { ToolsModule } from './tools/tools.module.js';

@Module({
  imports: [ConfigModule, DbModule, AuthModule, ContactsModule, ToolsModule, AiModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TraceRouteInterceptor },
  ],
})
export class AppModule {}
