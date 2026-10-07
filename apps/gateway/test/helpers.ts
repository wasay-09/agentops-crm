import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { FixtureCrm } from '../evals/fixture-crm.js';
import { type Config, loadConfig } from '../src/config.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { seed } from '../src/db/seed.js';
import { buildApp } from '../src/http/app.js';
import { MockProvider } from '../src/providers/mock.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import type { ChatRequest, ChatResponse, LlmProvider } from '../src/providers/types.js';
import { createServices, type Services } from '../src/services.js';

export const SALES_KEY = 'ak_test_sales_000000000000000000';
export const ADMIN_KEY = 'ak_test_admin_000000000000000000';
export const auth = (key = SALES_KEY) => ({ authorization: `Bearer ${key}` });

const TABLES = [
  'llm_calls',
  'budget_reservations',
  'approvals',
  'tool_calls',
  'run_messages',
  'runs',
  'workflow_runs',
  'agents',
  'prompt_deployments',
  'prompt_versions',
  'prompts',
  'routing_policies',
  'models',
  'api_keys',
  'teams',
];

/** Provider that replies from a script — lets tests drive exact tool calls, errors and refusals. */
export class ScriptedProvider implements LlmProvider {
  readonly requests: ChatRequest[] = [];
  constructor(
    readonly name: string,
    private readonly script: (req: ChatRequest, n: number) => ChatResponse | Error | Promise<ChatResponse>,
  ) {}
  isConfigured() {
    return true;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const out = await this.script(req, this.requests.length);
    if (out instanceof Error) throw out;
    return out;
  }
}

export const text = (t: string, inputTokens = 100, outputTokens = 20): ChatResponse => ({
  text: t,
  toolCalls: [],
  stopReason: 'end',
  usage: { inputTokens, outputTokens },
});

export const toolUse = (name: string, args: unknown, id = `tc_${name}`): ChatResponse => ({
  text: '',
  toolCalls: [{ id, name, args }],
  stopReason: 'tool_use',
  usage: { inputTokens: 100, outputTokens: 20 },
});

export interface TestContext {
  app: FastifyInstance;
  services: Services;
  crm: FixtureCrm;
  handle: DbHandle;
  config: Config;
  close(): Promise<void>;
}

export async function createTestContext(
  opts: { providers?: LlmProvider[]; env?: Record<string, string> } = {},
): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.GATEWAY_TEST_DATABASE_URL ?? 'postgres://localhost:5432/agentops_gateway_test',
    SEED_SALES_API_KEY: SALES_KEY,
    SEED_ADMIN_API_KEY: ADMIN_KEY,
    LLM_MOCK_FALLBACK: 'true',
    ALLOW_FAULT_INJECTION: 'true',
    RATE_LIMIT_PER_MINUTE: '1000',
    ...opts.env,
  });
  const handle = createDb(config.DATABASE_URL, 5);
  await handle.db.execute(sql.raw(`truncate ${TABLES.join(', ')} restart identity cascade`));
  await seed(handle.db, config);
  const crm = new FixtureCrm();
  const providers = new ProviderRegistry([new MockProvider(0), ...(opts.providers ?? [])]);
  const app = await buildApp((log) =>
    createServices(config, handle.db, log, { tools: crm, providers, catalogTtlMs: 0 }),
  );
  return {
    app,
    services: app.services,
    crm,
    handle,
    config,
    close: (() => {
      let closed: Promise<void> | null = null;
      return () => {
        closed ??= app.close().then(() => handle.close());
        return closed;
      };
    })(),
  };
}
