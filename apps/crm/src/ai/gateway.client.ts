import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

export interface GatewayRequest {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
  /** `team` uses the CRM team's key (runs scope); `admin` uses the platform admin key. */
  key?: 'team' | 'admin';
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface GatewayResponse {
  status: number;
  body: unknown;
}

export const LONG_TIMEOUT_MS = 60_000;
export const SHORT_TIMEOUT_MS = 10_000;

/**
 * Thin HTTP client for the AI gateway. Status codes and error bodies are passed through so the
 * web app sees the gateway's own errors (e.g. 402 budget_exceeded); transport failures map to 502/504.
 */
@Injectable()
export class GatewayClient {
  private readonly logger = new Logger('GatewayClient');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async request(req: GatewayRequest): Promise<GatewayResponse> {
    const url = new URL(this.config.gatewayUrl + req.path);
    for (const [k, v] of Object.entries(req.query ?? {})) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${req.key === 'admin' ? this.config.gatewayAdminKey : this.config.gatewayApiKey}`,
      accept: 'application/json',
    };
    if (req.body !== undefined) headers['content-type'] = 'application/json';
    if (req.idempotencyKey) headers['idempotency-key'] = req.idempotencyKey;

    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: AbortSignal.timeout(req.timeoutMs ?? SHORT_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      this.logger.warn(`${req.method} ${req.path} failed: ${e instanceof Error ? e.message : String(e)}`);
      return timedOut
        ? {
            status: 504,
            body: { error: { code: 'gateway_timeout', message: 'AI gateway did not respond in time' } },
          }
        : {
            status: 502,
            body: { error: { code: 'gateway_unavailable', message: 'AI gateway is unavailable' } },
          };
    }

    const text = await res.text();
    if (!text) return { status: res.status, body: null };
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      this.logger.warn(`${req.method} ${req.path} returned non-JSON (${res.status})`);
      return {
        status: 502,
        body: { error: { code: 'bad_gateway_response', message: 'AI gateway returned an invalid response' } },
      };
    }
  }
}
