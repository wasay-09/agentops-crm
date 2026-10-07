import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

/** Names the active HTTP server span after the matched route, e.g. `POST /tools/:name`. No-op without tracing. */
@Injectable()
export class TraceRouteInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const span = trace.getActiveSpan();
    if (span) {
      const req = ctx.switchToHttp().getRequest<Request>();
      const route = (req.route as { path?: string } | undefined)?.path;
      if (route) {
        span.updateName(`${req.method} ${route}`);
        span.setAttribute('http.route', route);
      }
    }
    return next.handle();
  }
}
