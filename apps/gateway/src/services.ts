import type { FastifyBaseLogger } from 'fastify';
import { RunRepository } from './agents/repo.js';
import { AgentRuntime } from './agents/runtime.js';
import { ApprovalService } from './approvals/service.js';
import { BudgetService } from './budget/budget.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { PromptRegistry } from './prompts/registry.js';
import { ProviderRegistry } from './providers/registry.js';
import { CircuitBreaker } from './routing/breaker.js';
import { Catalog } from './routing/catalog.js';
import { LlmService } from './routing/llm-service.js';
import { Router } from './routing/router.js';
import { HttpToolExecutor, type ToolExecutor } from './tools/registry.js';
import { Ledger } from './usage/ledger.js';
import { UsageService } from './usage/summary.js';
import { WorkflowEngine } from './workflows/engine.js';

export interface Services {
  config: Config;
  db: Db;
  catalog: Catalog;
  providers: ProviderRegistry;
  breaker: CircuitBreaker;
  router: Router;
  budget: BudgetService;
  llm: LlmService;
  prompts: PromptRegistry;
  runs: RunRepository;
  runtime: AgentRuntime;
  workflows: WorkflowEngine;
  approvals: ApprovalService;
  usage: UsageService;
  tools: ToolExecutor;
}

export interface ServiceOverrides {
  tools?: ToolExecutor;
  providers?: ProviderRegistry;
  catalogTtlMs?: number;
}

/** Composition root: wires every service once. Tests and evals swap the tool executor or providers. */
export function createServices(
  config: Config,
  db: Db,
  log: FastifyBaseLogger,
  overrides: ServiceOverrides = {},
): Services {
  const catalog = new Catalog(db, overrides.catalogTtlMs);
  const providers = overrides.providers ?? ProviderRegistry.fromConfig(config);
  const breaker = new CircuitBreaker();
  const router = new Router(catalog, providers, breaker, { mockFallback: config.LLM_MOCK_FALLBACK });
  const budget = new BudgetService(db);
  const llm = new LlmService(router, providers, breaker, budget, new Ledger(db), log);
  const prompts = new PromptRegistry(db);
  const runs = new RunRepository(db);
  const tools = overrides.tools ?? new HttpToolExecutor(config.CRM_TOOL_URL, config.CRM_TOOL_TOKEN);
  const runtime = new AgentRuntime(db, runs, catalog, prompts, llm, tools, log);
  const workflows = new WorkflowEngine(db, runtime, tools, catalog, log);
  const approvals = new ApprovalService(db, runtime, workflows, runs);
  const usage = new UsageService(db, budget);
  return {
    config,
    db,
    catalog,
    providers,
    breaker,
    router,
    budget,
    llm,
    prompts,
    runs,
    runtime,
    workflows,
    approvals,
    usage,
    tools,
  };
}
