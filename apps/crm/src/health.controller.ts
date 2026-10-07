import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type pg from 'pg';
import { Public } from './auth/decorators.js';
import { PG_POOL } from './db/client.js';

@Public()
@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  @Get('health')
  async health() {
    try {
      await this.pool.query('select 1');
      return { status: 'ok', service: 'crm' };
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'db_unavailable', message: 'Database unavailable' },
      });
    }
  }
}
