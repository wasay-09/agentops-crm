import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Service-to-service auth for the agent tool API (gateway → CRM). */
@Injectable()
export class ToolTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Hash both sides so lengths match and the comparison is constant-time.
    if (!token || !timingSafeEqual(digest(token), digest(this.config.toolToken))) {
      throw new UnauthorizedException({
        ok: false,
        error: { code: 'unauthorized', message: 'Invalid tool token' },
      });
    }
    return true;
  }
}
