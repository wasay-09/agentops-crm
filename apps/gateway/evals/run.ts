/**
 * Eval runner: golden cases through the real gateway stack (HTTP → router → agent loop → tools),
 * against an in-memory CRM fixture.
 *
 *   EVAL_MODE=mock (default)  deterministic mock provider — free, runs on every CI push
 *   EVAL_MODE=live            real providers (needs API keys) — nightly / manual
 *
 * Exits non-zero if the pass rate is below EVAL_MIN_PASS_RATE (default 0.9) or any critical case fails.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunDetail, WorkflowRun } from '@agentops/contracts';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { ensureDatabase, runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { buildApp } from '../src/http/app.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { createServices } from '../src/services.js';
import { FixtureCrm } from './fixture-crm.js';

interface EvalCase {
  id: string;
  description: string;
  critical?: boolean;
  setup?: {
    budgetUsd?: number;
    spentUsd?: number;
    promptWeights?: Record<string, { version: number; weight: number }[]>;
    fault?: string;
    crmFailing?: string[];
  };
  request:
    | { type: 'run'; agent: string; input: string; context?: Record<string, unknown> }
    | { type: 'workflow'; workflow: string; input: Record<string, unknown> }
    | { type: 'complete'; taskType: string; prompt: string };
  then?: { decide: 'approve' | 'reject'; note?: string }[];
  expect: {
    httpStatus?: number;
    errorCode?: string;
    status?: string;
    toolsCalled?: string[];
    toolsNotCalled?: string[];
    approvalsRequested?: number;
    approvalTools?: string[];
    outputContains?: string[];
    outputExcludes?: string[];
    outputMatches?: string;
    promptVersion?: number;
    routingReasons?: string[];
    modelTiers?: string[];
    maxCostUsd?: number;
    crmNoteContains?: { contactId: number; text: string; author?: string };
    crmNoteCount?: { contactId: number; count: number };
    dealStage?: { dealId: number; stage: string };
  };
}

interface CaseResult {
  id: string;
  critical: boolean;
  passed: boolean;
  failures: string[];
  costUsd: number;
  latencyMs: number;
  models: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.env.EVAL_MODE === 'live' ? 'live' : 'mock';
const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.9);
const only = process.env.EVAL_CASE;
const APPROVER = 'eval@acme.test';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.EVAL_DATABASE_URL ?? 'postgres://localhost:5432/agentops_gateway_eval',
  LLM_MOCK_FALLBACK: mode === 'mock' ? 'true' : 'false',
  ...(mode === 'mock' && { ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' }),
  MOCK_LATENCY_MS: '0',
  ALLOW_FAULT_INJECTION: 'true',
  RATE_LIMIT_PER_MINUTE: '10000',
});
if (mode === 'live' && !config.ANTHROPIC_API_KEY && !config.OPENAI_API_KEY && !config.GEMINI_API_KEY) {
  console.error('EVAL_MODE=live needs at least one provider API key');
  process.exit(2);
}

const cases: EvalCase[] = JSON.parse(readFileSync(path.join(here, 'cases.json'), 'utf8'));
await ensureDatabase(config.DATABASE_URL);
const handle = createDb(config.DATABASE_URL, 5);
await runMigrations(handle.db);
const crm = new FixtureCrm();
const app = await buildApp(
  (log) =>
    createServices(config, handle.db, log, {
      tools: crm,
      providers: ProviderRegistry.fromConfig(config),
      catalogTtlMs: 0,
    }),
  { logger: process.env.EVAL_LOG ? { level: process.env.EVAL_LOG } : false },
);
const s = app.services;
const headers = { authorization: `Bearer ${config.SEED_SALES_API_KEY}` };

// Teams and API keys stay put between cases (auth lookups are cached); everything else is reset.
const TABLES =
  'llm_calls, budget_reservations, approvals, tool_calls, run_messages, runs, workflow_runs, agents, prompt_deployments, prompt_versions, prompts, routing_policies, models';

async function resetState() {
  await handle.db.execute(sql.raw(`truncate ${TABLES} restart identity cascade`));
  await seed(handle.db, config);
  await handle.db.execute(
    sql`update teams set monthly_budget_usd = case name when 'sales' then 50 else 100 end, soft_limit_pct = 80`,
  );
  s.catalog.invalidate();
  s.breaker.reset();
  crm.reset();
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  await resetState();
  const failures: string[] = [];
  const check = (ok: boolean, msg: string) => {
    if (!ok) failures.push(msg);
  };

  // ---- setup ----
  const [team] = (await handle.pool.query("select id from teams where name = 'sales'")).rows;
  if (c.setup?.budgetUsd !== undefined)
    await handle.pool.query('update teams set monthly_budget_usd = $1 where id = $2', [
      c.setup.budgetUsd,
      team.id,
    ]);
  if (c.setup?.spentUsd) {
    await handle.pool.query(
      `insert into llm_calls (team_id, task_type, step, attempt, provider, model, routing_reason, status, cost_usd, latency_ms, started_at)
       values ($1, 'chat', 1, 1, 'seed', 'seed:prior-spend', 'primary', 'ok', $2, 0, now())`,
      [team.id, c.setup.spentUsd],
    );
  }
  for (const [name, weights] of Object.entries(c.setup?.promptWeights ?? {}))
    await s.prompts.setDeployment(name, weights, 'eval');
  for (const t of c.setup?.crmFailing ?? []) crm.failing.add(t as never);
  let fault = c.setup?.fault;
  if (fault === '$primary') {
    const taskType =
      c.request.type === 'complete'
        ? c.request.taskType
        : ((await s.catalog.agent((c.request as { agent?: string }).agent ?? ''))?.taskType ?? 'chat');
    fault = (await s.router.plan(taskType, 'ok')).candidates[0]?.model.id;
  }
  const reqHeaders = { ...headers, ...(fault && { 'x-fault-model': fault }) };

  // ---- request ----
  const t0 = performance.now();
  const url =
    c.request.type === 'run'
      ? '/v1/runs'
      : c.request.type === 'workflow'
        ? `/v1/workflows/${c.request.workflow}/runs`
        : '/v1/complete';
  const payload =
    c.request.type === 'run'
      ? { agent: c.request.agent, input: c.request.input, context: c.request.context, actor: 'rep@acme.test' }
      : c.request.type === 'workflow'
        ? { input: c.request.input, actor: 'rep@acme.test' }
        : { taskType: c.request.taskType, prompt: c.request.prompt };
  const res = await app.inject({ method: 'POST', url, headers: reqHeaders, payload });
  const body = res.json();

  let run: RunDetail | null = c.request.type === 'run' && res.statusCode < 300 ? body : null;
  let workflow: WorkflowRun | null = c.request.type === 'workflow' && res.statusCode < 300 ? body : null;
  let approvalCount = 0;
  const approvalTools: string[] = [];

  // ---- follow-up decisions on pending approvals ----
  const pendingIds = async () =>
    (await app.inject({ method: 'GET', url: '/v1/approvals?status=pending', headers })).json().approvals as {
      id: string;
      payload: { tool?: string };
    }[];
  let pending = await pendingIds();
  approvalCount = pending.length;
  approvalTools.push(...pending.map((p) => p.payload.tool).filter((t): t is string => Boolean(t)));
  for (const step of c.then ?? []) {
    const next = pending[0];
    if (!next) {
      failures.push(`expected a pending approval to ${step.decide}, found none`);
      break;
    }
    const decided = (
      await app.inject({
        method: 'POST',
        url: `/v1/approvals/${next.id}`,
        headers,
        payload: { decision: step.decide, decidedBy: APPROVER, note: step.note },
      })
    ).json();
    if (decided.run) run = decided.run;
    if (decided.workflowRun) workflow = decided.workflowRun;
    pending = await pendingIds();
    for (const p of pending)
      if (p.payload.tool && !approvalTools.includes(p.payload.tool)) approvalTools.push(p.payload.tool);
  }
  const latencyMs = Math.round(performance.now() - t0);

  // ---- gather facts ----
  const runIds = run
    ? [run.id]
    : workflow
      ? workflow.steps.map((st) => st.runId).filter((x): x is string => Boolean(x))
      : [];
  const details: RunDetail[] = [];
  for (const id of runIds)
    details.push((await app.inject({ method: 'GET', url: `/v1/runs/${id}`, headers })).json());
  const calls =
    c.request.type === 'complete'
      ? (
          await handle.pool.query(
            "select model, routing_reason, status, cost_usd from llm_calls where model <> 'seed:prior-spend'",
          )
        ).rows.map((r) => ({
          model: r.model as string,
          routingReason: r.routing_reason as string,
          status: r.status as string,
          costUsd: Number(r.cost_usd),
        }))
      : details.flatMap((d) => d.llmCalls);
  const tools = details.flatMap((d) => d.toolCalls.map((t) => t.toolName));
  const cost = calls.reduce((sum, x) => sum + x.costUsd, 0);
  const status = run?.status ?? workflow?.status;
  const output =
    run?.output ??
    (workflow ? String(workflow.context.draft ?? '') : c.request.type === 'complete' ? body.text : '') ??
    '';
  const allModels = await s.catalog.allModels();
  const tierOf = (id: string) => allModels.find((m) => m.id === id || `mock:${m.modelName}` === id)?.tier;

  // ---- checks ----
  const e = c.expect;
  if (e.httpStatus !== undefined)
    check(res.statusCode === e.httpStatus, `http ${res.statusCode} ≠ ${e.httpStatus}`);
  else check(res.statusCode < 300, `http ${res.statusCode}: ${JSON.stringify(body.error ?? body)}`);
  if (e.errorCode) check(body.error?.code === e.errorCode, `error code ${body.error?.code} ≠ ${e.errorCode}`);
  if (e.status)
    check(
      status === e.status,
      `status ${status} ≠ ${e.status}${run?.error ? ` (${run.error})` : ''}${workflow?.error ? ` (${workflow.error})` : ''}`,
    );
  for (const t of e.toolsCalled ?? [])
    check(tools.includes(t), `expected tool ${t} to be called (called: ${tools.join(', ') || 'none'})`);
  for (const t of e.toolsNotCalled ?? [])
    check(!tools.includes(t) && !approvalTools.includes(t), `tool ${t} must not be called`);
  if (e.approvalsRequested !== undefined)
    check(approvalCount === e.approvalsRequested, `approvals ${approvalCount} ≠ ${e.approvalsRequested}`);
  for (const t of e.approvalTools ?? []) check(approvalTools.includes(t), `expected an approval for ${t}`);
  for (const t of e.outputContains ?? [])
    check(output.toLowerCase().includes(t.toLowerCase()), `output missing "${t}"`);
  for (const t of e.outputExcludes ?? [])
    check(!output.toLowerCase().includes(t.toLowerCase()), `output must not contain "${t}"`);
  if (e.outputMatches)
    check(new RegExp(e.outputMatches, 'im').test(output), `output does not match /${e.outputMatches}/`);
  if (e.promptVersion !== undefined)
    check(
      run?.promptVersion === e.promptVersion,
      `prompt version ${run?.promptVersion} ≠ ${e.promptVersion}`,
    );
  for (const r of e.routingReasons ?? [])
    check(
      calls.some((x) => x.routingReason === r),
      `no call with routing reason ${r}`,
    );
  if (e.modelTiers) {
    const ok = calls.filter((x) => x.status === 'ok');
    check(
      ok.length > 0 && ok.every((x) => e.modelTiers!.includes(tierOf(x.model) ?? '?')),
      `model tiers ${ok.map((x) => tierOf(x.model)).join(',')} not in ${e.modelTiers.join(',')}`,
    );
  }
  if (e.maxCostUsd !== undefined) check(cost <= e.maxCostUsd, `cost $${cost.toFixed(6)} > $${e.maxCostUsd}`);
  if (e.crmNoteContains) {
    const { contactId, text, author } = e.crmNoteContains;
    const hit = crm.notes.find(
      (n) => n.contactId === contactId && n.body.toLowerCase().includes(text.toLowerCase()),
    );
    check(Boolean(hit), `no CRM note on contact ${contactId} containing "${text}"`);
    if (hit && author) check(hit.author.includes(author), `note author "${hit.author}" missing "${author}"`);
  }
  if (e.crmNoteCount) {
    const n = crm.notes.filter((x) => x.contactId === e.crmNoteCount!.contactId).length;
    check(
      n === e.crmNoteCount.count,
      `contact ${e.crmNoteCount.contactId} has ${n} notes ≠ ${e.crmNoteCount.count}`,
    );
  }
  if (e.dealStage) {
    const d = crm.deals.find((x) => x.id === e.dealStage!.dealId);
    check(
      d?.stage === e.dealStage.stage,
      `deal ${e.dealStage.dealId} stage ${d?.stage} ≠ ${e.dealStage.stage}`,
    );
  }

  return {
    id: c.id,
    critical: Boolean(c.critical),
    passed: failures.length === 0,
    failures,
    costUsd: Math.round(cost * 1e6) / 1e6,
    latencyMs,
    models: [...new Set(calls.filter((x) => x.status === 'ok').map((x) => x.model))],
  };
}

const results: CaseResult[] = [];
for (const c of cases.filter((x) => !only || x.id === only)) {
  try {
    results.push(await runCase(c));
  } catch (err) {
    results.push({
      id: c.id,
      critical: Boolean(c.critical),
      passed: false,
      failures: [`crashed: ${(err as Error).message}`],
      costUsd: 0,
      latencyMs: 0,
      models: [],
    });
  }
  const r = results.at(-1)!;
  console.log(
    `${r.passed ? '✔' : '✘'} ${r.id.padEnd(28)} ${`$${r.costUsd.toFixed(6)}`.padStart(11)} ${`${r.latencyMs}ms`.padStart(8)}  ${r.models.join(', ')}`,
  );
  for (const f of r.failures) console.log(`    · ${f}`);
}
await app.close();
await handle.close();

const passed = results.filter((r) => r.passed).length;
const passRate = results.length ? passed / results.length : 0;
const criticalFailed = results.filter((r) => r.critical && !r.passed).map((r) => r.id);
const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
const ok = passRate >= minPassRate && criticalFailed.length === 0;

const md = [
  `## Evals (${mode})`,
  '',
  `**${passed}/${results.length} passed (${(passRate * 100).toFixed(1)}%)** — threshold ${(minPassRate * 100).toFixed(0)}%, critical failures: ${criticalFailed.length ? criticalFailed.join(', ') : 'none'} · total simulated cost $${totalCost.toFixed(4)}`,
  '',
  '| | Case | Cost | Latency | Models | Failures |',
  '|---|---|---:|---:|---|---|',
  ...results.map(
    (r) =>
      `| ${r.passed ? '✅' : '❌'} | ${r.id}${r.critical ? ' ⚑' : ''} | $${r.costUsd.toFixed(6)} | ${r.latencyMs}ms | ${r.models.join(', ')} | ${r.failures.join('; ')} |`,
  ),
  '',
].join('\n');
writeFileSync(path.join(here, '..', 'eval-report.md'), md);
writeFileSync(
  path.join(here, '..', 'eval-report.json'),
  JSON.stringify({ mode, passRate, passed, total: results.length, criticalFailed, results }, null, 2),
);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

console.log(
  `\n${passed}/${results.length} passed (${(passRate * 100).toFixed(1)}%), critical failures: ${criticalFailed.length}`,
);
process.exit(ok ? 0 : 1);
