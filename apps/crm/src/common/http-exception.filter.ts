import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'rate_limited',
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Normalises every error to `{ error: { code, message } }` (or `{ ok: false, error }` on the tool
 * API). Exceptions that already carry an `{ error: { code } }` body keep their code and message.
 * Unexpected errors are logged and returned as a generic 500 — internals never leak.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    // The tool API speaks the `{ ok, data | error }` envelope from the contracts package.
    const envelope = http.getRequest<Request>().path.startsWith('/tools');
    const send = (status: number, error: { code: string; message: string }) =>
      res.status(status).json(envelope ? { ok: false, error } : { error });

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') {
        send(status, { code: body.error.code, message: String(body.error.message ?? '') });
        return;
      }
      const raw = isRecord(body) ? body.message : body;
      const message = Array.isArray(raw) ? raw.join('; ') : String(raw ?? exception.message);
      send(status, { code: CODES[status] ?? 'error', message });
      return;
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    send(HttpStatus.INTERNAL_SERVER_ERROR, { code: 'internal_error', message: 'Something went wrong' });
  }
}
