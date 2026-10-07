import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from './auth.types.js';

/** Allows only CRM users with the `admin` role. Runs after the global JWT guard. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.role !== 'admin') {
      throw new ForbiddenException({ error: { code: 'forbidden', message: 'Admin role required' } });
    }
    return true;
  }
}
