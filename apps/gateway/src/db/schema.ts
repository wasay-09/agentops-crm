import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 6, mode: 'number' });

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  monthlyBudgetUsd: money('monthly_budget_usd').notNull(),
  softLimitPct: integer('soft_limit_pct').notNull().default(80),
  createdAt: createdAt(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scopes: text('scopes').array().notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('api_keys_team_idx').on(t.teamId)],
);

export const models = pgTable('models', {
  id: text('id').primaryKey(), // e.g. anthropic:claude-sonnet-5-5
  provider: text('provider').notNull(),
  modelName: text('model_name').notNull(),
  tier: text('tier').$type<'cheap' | 'standard' | 'premium'>().notNull(),
  inputUsdPerMTok: money('input_usd_per_mtok').notNull(),
  outputUsdPerMTok: money('output_usd_per_mtok').notNull(),
  params: jsonb('params').$type<ModelParams>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
});

export interface ModelParams {
  /** Anthropic output_config.effort */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Anthropic server-side refusal fallback */
  refusalFallback?: boolean;
}

export const routingPolicies = pgTable('routing_policies', {
  taskType: text('task_type').primaryKey(),
  chain: text('chain').array().notNull(),
  budgetModel: text('budget_model'),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const prompts = pgTable('prompts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: createdAt(),
});

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promptId: uuid('prompt_id')
      .notNull()
      .references(() => prompts.id),
    version: integer('version').notNull(),
    template: text('template').notNull(),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('prompt_versions_prompt_version_uq').on(t.promptId, t.version)],
);

export const promptDeployments = pgTable('prompt_deployments', {
  promptId: uuid('prompt_id')
    .primaryKey()
    .references(() => prompts.id),
  weights: jsonb('weights').$type<{ version: number; weight: number }[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

export const agents = pgTable('agents', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  taskType: text('task_type').notNull(),
  promptName: text('prompt_name').notNull(),
  tools: text('tools').array().notNull(),
  maxSteps: integer('max_steps').notNull().default(6),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    workflow: text('workflow').notNull(),
    status: text('status').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull(),
    steps: jsonb('steps').$type<WorkflowStepRow[]>().notNull(),
    currentStep: integer('current_step').notNull().default(0),
    error: text('error'),
    actor: text('actor'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('workflow_runs_team_idx').on(t.teamId, t.createdAt)],
);

export interface WorkflowStepRow {
  id: string;
  type: 'agent' | 'approval' | 'tool';
  label: string;
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'skipped' | 'failed';
  runId: string | null;
  approvalId: string | null;
  output: unknown;
}

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    agentSlug: text('agent_slug').notNull(),
    taskType: text('task_type').notNull(),
    status: text('status').notNull(),
    input: text('input').notNull(),
    context: jsonb('context').$type<Record<string, unknown>>(),
    actor: text('actor'),
    idempotencyKey: text('idempotency_key'),
    systemPrompt: text('system_prompt').notNull(),
    promptVersionId: uuid('prompt_version_id').references(() => promptVersions.id),
    promptVersion: integer('prompt_version'),
    step: integer('step').notNull().default(0),
    output: text('output'),
    error: text('error'),
    traceId: text('trace_id'),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('runs_team_idempotency_uq')
      .on(t.teamId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('runs_team_created_idx').on(t.teamId, t.createdAt),
  ],
);

export const runMessages = pgTable(
  'run_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    seq: integer('seq').notNull(),
    message: jsonb('message').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('run_messages_run_seq_uq').on(t.runId, t.seq)],
);

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    step: integer('step').notNull(),
    providerCallId: text('provider_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    mode: text('mode').$type<'read' | 'write'>().notNull(),
    args: jsonb('args'),
    result: jsonb('result'),
    status: text('status').notNull(),
    latencyMs: integer('latency_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('tool_calls_run_idx').on(t.runId)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    kind: text('kind').$type<'tool_call' | 'workflow_step'>().notNull(),
    status: text('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
    title: text('title').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    runId: uuid('run_id').references(() => runs.id),
    toolCallId: uuid('tool_call_id').references(() => toolCalls.id),
    workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id),
    workflowStepId: text('workflow_step_id'),
    requestedBy: text('requested_by'),
    decidedBy: text('decided_by'),
    note: text('note'),
    createdAt: createdAt(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [index('approvals_team_status_idx').on(t.teamId, t.status)],
);

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    runId: uuid('run_id').references(() => runs.id),
    agentSlug: text('agent_slug'),
    taskType: text('task_type').notNull(),
    step: integer('step').notNull(),
    attempt: integer('attempt').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    routingReason: text('routing_reason').notNull(),
    status: text('status').$type<'ok' | 'error'>().notNull(),
    errorCode: text('error_code'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: money('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    promptVersionId: uuid('prompt_version_id').references(() => promptVersions.id),
    traceId: text('trace_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('llm_calls_run_step_attempt_uq').on(t.runId, t.step, t.attempt),
    index('llm_calls_team_started_idx').on(t.teamId, t.startedAt),
  ],
);

export const budgetReservations = pgTable(
  'budget_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    amountUsd: money('amount_usd').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('budget_reservations_team_idx').on(t.teamId)],
);
