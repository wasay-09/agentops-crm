import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * Starts OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set. HTTP instrumentation extracts the
 * incoming `traceparent`, so tool calls from the gateway show up inside the gateway's trace.
 * Must run before the app (and express/http) are loaded — see main.ts.
 */
export async function startTracing(): Promise<NodeSDK | undefined> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;
  const [{ OTLPTraceExporter }, { HttpInstrumentation }] = await Promise.all([
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/instrumentation-http'),
  ]);
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'agentops-crm',
    traceExporter: new OTLPTraceExporter(),
    // Express instrumentation can't hook ESM imports, so route names are set by TraceRouteInterceptor.
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/health' }),
    ],
  });
  sdk.start();
  const shutdown = () => {
    sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return sdk;
}
