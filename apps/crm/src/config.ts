export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  toolToken: string;
  gatewayUrl: string;
  gatewayApiKey: string;
  gatewayAdminKey: string;
  corsOrigin: string[];
  runMigrations: boolean;
  seedOnStart: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

const flag = (v: string | undefined) => v === 'true' || v === '1';

/** Reads configuration from the environment. Called when the Nest module graph is built. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/agentops_crm',
    jwtSecret: env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
    toolToken: env.CRM_TOOL_TOKEN ?? 'dev-tool-token',
    gatewayUrl: (env.GATEWAY_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
    gatewayApiKey: env.GATEWAY_API_KEY ?? 'ak_dev_sales_00000000000000000000',
    gatewayAdminKey: env.GATEWAY_ADMIN_KEY ?? 'ak_dev_admin_00000000000000000000',
    corsOrigin: (env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    runMigrations: flag(env.RUN_MIGRATIONS),
    seedOnStart: flag(env.SEED_ON_START),
  };
}
