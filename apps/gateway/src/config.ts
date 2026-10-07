import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().default('postgres://localhost:5432/agentops_gateway'),

  CRM_TOOL_URL: z.string().default('http://localhost:3000'),
  CRM_TOOL_TOKEN: z.string().default('dev-tool-token'),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  LLM_MOCK_FALLBACK: bool(true),
  MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().default(60_000),

  SEED_SALES_API_KEY: z.string().default('ak_dev_sales_00000000000000000000'),
  SEED_ADMIN_API_KEY: z.string().default('ak_dev_admin_00000000000000000000'),

  RUN_MIGRATIONS: bool(false),
  SEED_ON_START: bool(false),
  ALLOW_FAULT_INJECTION: bool(false),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(120),
  CORS_ORIGIN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as unset so `.env` files can leave keys blank.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  return ConfigSchema.parse(cleaned);
}

const DEV_DEFAULTS = {
  CRM_TOOL_TOKEN: 'dev-tool-token',
  SEED_SALES_API_KEY: 'ak_dev_sales_00000000000000000000',
  SEED_ADMIN_API_KEY: 'ak_dev_admin_00000000000000000000',
} as const;

/** Refuse to boot in production with the well-known dev secrets from this repo. */
export function assertProductionSafe(config: Config): void {
  if (config.NODE_ENV !== 'production') return;
  const unsafe = (Object.keys(DEV_DEFAULTS) as (keyof typeof DEV_DEFAULTS)[]).filter(
    (k) => config[k] === DEV_DEFAULTS[k],
  );
  if (unsafe.length > 0) {
    throw new Error(`Refusing to start in production with dev default secrets: ${unsafe.join(', ')}`);
  }
}
