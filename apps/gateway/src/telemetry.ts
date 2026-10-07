import { context, propagation, type Span, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

/** Starts OpenTelemetry when an OTLP endpoint is configured; otherwise spans are no-ops. */
export function startTelemetry(endpoint: string | undefined, serviceName = 'agentops-gateway'): void {
  if (!endpoint || sdk) return;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = null;
}

export const tracer = trace.getTracer('agentops-gateway');

/** Run `fn` inside an active span; records exceptions and always ends the span. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    for (const [k, v] of Object.entries(attributes)) if (v !== undefined) span.setAttribute(k, v);
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Current trace id, or null when tracing is off. */
export function currentTraceId(): string | null {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && ctx.traceId !== '00000000000000000000000000000000' ? ctx.traceId : null;
}

/** W3C traceparent headers for outgoing calls (the CRM joins the same trace). */
export function traceHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers;
}
