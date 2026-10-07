import { z } from 'zod';

/** Gateway HTTP API contract (v1). Dates are ISO strings on the wire. */

export const TASK_TYPES = ['chat', 'summarize', 'draft_email', 'classify'] as const;
export const TaskType = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskType>;

export const RUN_STATUSES = ['running', 'awaiting_approval', 'completed', 'failed'] as const;
export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;

export const ROUTING_REASONS = ['primary', 'fallback', 'budget_downgrade', 'mock_fallback'] as const;
export const RoutingReason = z.enum(ROUTING_REASONS);
export type RoutingReason = z.infer<typeof RoutingReason>;

export const BudgetState = z.enum(['ok', 'soft', 'hard']);
export type BudgetState = z.infer<typeof BudgetState>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- runs ----------

export const CreateRunRequest = z.object({
  agent: z.string().min(1),
  input: z.string().min(1).max(8000),
  /** Free-form context rendered into the prompt, e.g. { contactId: 12 }. */
  context: z.record(z.string(), z.unknown()).optional(),
  /** Who triggered the run (CRM user email); recorded for audit. */
  actor: z.string().optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const LlmCall = z.object({
  id: z.string(),
  step: z.number().int(),
  attempt: z.number().int(),
  provider: z.string(),
  model: z.string(),
  routingReason: RoutingReason,
  status: z.enum(['ok', 'error']),
  errorCode: z.string().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  latencyMs: z.number().int(),
  promptVersion: z.number().int().nullable(),
  startedAt: z.string(),
});
export type LlmCall = z.infer<typeof LlmCall>;

export const ToolCallStatus = z.enum([
  'executed',
  'failed',
  'pending_approval',
  'approved',
  'rejected',
  'invalid_args',
]);
export type ToolCallStatus = z.infer<typeof ToolCallStatus>;

export const ToolCall = z.object({
  id: z.string(),
  step: z.number().int(),
  toolName: z.string(),
  mode: z.enum(['read', 'write']),
  args: z.unknown(),
  result: z.unknown().nullable(),
  status: ToolCallStatus,
  latencyMs: z.number().int().nullable(),
  startedAt: z.string(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const TimelineEvent = z.object({
  kind: z.enum(['llm', 'tool', 'approval']),
  label: z.string(),
  startedAt: z.string(),
  durationMs: z.number().int().nullable(),
  status: z.string(),
  detail: z.string().optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const RunSummary = z.object({
  id: z.string(),
  agent: z.string(),
  status: RunStatus,
  input: z.string(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  promptVersion: z.number().int().nullable(),
  totalCostUsd: z.number(),
  totalTokens: z.number().int(),
  traceId: z.string().nullable(),
  workflowRunId: z.string().nullable(),
  actor: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const Approval = z.object({
  id: z.string(),
  kind: z.enum(['tool_call', 'workflow_step']),
  status: z.enum(['pending', 'approved', 'rejected']),
  title: z.string(),
  /** Tool name + args for tool calls, or the step payload (e.g. email draft) for workflows. */
  payload: z.record(z.string(), z.unknown()),
  runId: z.string().nullable(),
  workflowRunId: z.string().nullable(),
  requestedBy: z.string().nullable(),
  decidedBy: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type Approval = z.infer<typeof Approval>;

export const RunDetail = RunSummary.extend({
  llmCalls: z.array(LlmCall),
  toolCalls: z.array(ToolCall),
  approvals: z.array(Approval),
  timeline: z.array(TimelineEvent),
});
export type RunDetail = z.infer<typeof RunDetail>;

export const ListRunsQuery = z.object({
  agent: z.string().optional(),
  status: RunStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ListRunsResponse = z.object({ runs: z.array(RunSummary) });

// ---------- approvals ----------

export const ListApprovalsQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const ListApprovalsResponse = z.object({ approvals: z.array(Approval) });

export const DecideApprovalRequest = z.object({
  decision: z.enum(['approve', 'reject']),
  decidedBy: z.string().min(1),
  note: z.string().max(1000).optional(),
});
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequest>;

export const DecideApprovalResponse = z.object({
  approval: Approval,
  run: RunSummary.nullable(),
  workflowRun: z.lazy(() => WorkflowRun).nullable(),
});

// ---------- workflows ----------

export const WorkflowStatus = z.enum(['running', 'awaiting_approval', 'completed', 'failed', 'cancelled']);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const WorkflowStepState = z.object({
  id: z.string(),
  type: z.enum(['agent', 'approval', 'tool']),
  label: z.string(),
  status: z.enum(['pending', 'running', 'waiting', 'completed', 'skipped', 'failed']),
  runId: z.string().nullable(),
  approvalId: z.string().nullable(),
  output: z.unknown().nullable(),
});
export type WorkflowStepState = z.infer<typeof WorkflowStepState>;

export const WorkflowRun = z.object({
  id: z.string(),
  workflow: z.string(),
  status: WorkflowStatus,
  input: z.record(z.string(), z.unknown()),
  context: z.record(z.string(), z.unknown()),
  steps: z.array(WorkflowStepState),
  error: z.string().nullable(),
  actor: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

export const StartWorkflowRequest = z.object({
  input: z.record(z.string(), z.unknown()),
  actor: z.string().optional(),
});
export type StartWorkflowRequest = z.infer<typeof StartWorkflowRequest>;

// ---------- plain completion ----------

export const CompleteRequest = z.object({
  taskType: TaskType,
  system: z.string().max(8000).optional(),
  prompt: z.string().min(1).max(16000),
  maxTokens: z.number().int().min(1).max(8000).optional(),
});
export const CompleteResponse = z.object({
  text: z.string(),
  model: z.string(),
  routingReason: RoutingReason,
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  latencyMs: z.number().int(),
});

// ---------- usage ----------

export const UsageSummaryQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

export const UsageSummary = z.object({
  team: z.object({ id: z.string(), name: z.string() }),
  rangeDays: z.number().int(),
  totals: z.object({
    costUsd: z.number(),
    calls: z.number().int(),
    runs: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    errorRate: z.number(),
    p95LatencyMs: z.number(),
  }),
  budget: z.object({
    monthlyLimitUsd: z.number(),
    softLimitPct: z.number(),
    monthToDateUsd: z.number(),
    state: BudgetState,
  }),
  costByDayAgent: z.array(
    z.object({ day: z.string(), agent: z.string(), costUsd: z.number(), calls: z.number().int() }),
  ),
  byAgent: z.array(
    z.object({
      agent: z.string(),
      calls: z.number().int(),
      costUsd: z.number(),
      p95LatencyMs: z.number(),
      errorRate: z.number(),
    }),
  ),
  byModel: z.array(
    z.object({
      model: z.string(),
      calls: z.number().int(),
      costUsd: z.number(),
      p95LatencyMs: z.number(),
      errorRate: z.number(),
    }),
  ),
  byPromptVersion: z.array(
    z.object({
      prompt: z.string(),
      version: z.number().int(),
      runs: z.number().int(),
      avgCostUsd: z.number(),
      avgLatencyMs: z.number(),
    }),
  ),
  routingReasons: z.array(z.object({ reason: RoutingReason, calls: z.number().int() })),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

// ---------- admin: agents ----------

export const AgentConfig = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  taskType: TaskType,
  promptName: z.string().min(1),
  tools: z.array(z.string()),
  maxSteps: z.number().int().min(1).max(20),
  enabled: z.boolean(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;
export const UpsertAgentRequest = AgentConfig.omit({ slug: true }).partial();

// ---------- admin: prompts ----------

export const PromptVersion = z.object({
  id: z.string(),
  version: z.number().int(),
  template: z.string(),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type PromptVersion = z.infer<typeof PromptVersion>;

export const DeploymentWeight = z.object({
  version: z.number().int().positive(),
  weight: z.number().int().min(0).max(100),
});
export type DeploymentWeight = z.infer<typeof DeploymentWeight>;

export const Prompt = z.object({
  name: z.string(),
  description: z.string().nullable(),
  versions: z.array(PromptVersion),
  deployment: z.array(DeploymentWeight),
  deploymentUpdatedAt: z.string().nullable(),
  deploymentUpdatedBy: z.string().nullable(),
});
export type Prompt = z.infer<typeof Prompt>;

export const CreatePromptVersionRequest = z.object({
  template: z.string().min(1).max(20000),
  notes: z.string().max(500).optional(),
  createdBy: z.string().optional(),
});

export const UpdateDeploymentRequest = z.object({
  weights: z
    .array(DeploymentWeight)
    .min(1)
    .refine((w) => w.reduce((s, x) => s + x.weight, 0) === 100, 'weights must sum to 100'),
  updatedBy: z.string().optional(),
});

// ---------- admin: models / routing / teams ----------

export const ModelInfo = z.object({
  id: z.string(),
  provider: z.string(),
  modelName: z.string(),
  tier: z.enum(['cheap', 'standard', 'premium']),
  inputUsdPerMTok: z.number(),
  outputUsdPerMTok: z.number(),
  enabled: z.boolean(),
  available: z.boolean(),
  circuitOpen: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const RoutingPolicy = z.object({
  taskType: TaskType,
  chain: z.array(z.string()).min(1),
  budgetModel: z.string().nullable(),
  maxOutputTokens: z.number().int().min(1),
  updatedAt: z.string(),
});
export type RoutingPolicy = z.infer<typeof RoutingPolicy>;
export const UpdateRoutingRequest = RoutingPolicy.omit({ taskType: true, updatedAt: true }).partial();

export const Team = z.object({
  id: z.string(),
  name: z.string(),
  monthlyBudgetUsd: z.number(),
  softLimitPct: z.number().int(),
  createdAt: z.string(),
});
export type Team = z.infer<typeof Team>;
export const CreateTeamRequest = z.object({
  name: z.string().min(1),
  monthlyBudgetUsd: z.number().min(0),
  softLimitPct: z.number().int().min(1).max(100).default(80),
});
export const UpdateBudgetRequest = z.object({
  monthlyBudgetUsd: z.number().min(0),
  softLimitPct: z.number().int().min(1).max(100).optional(),
});
export const CreateApiKeyRequest = z.object({
  name: z.string().min(1),
  scopes: z
    .array(z.enum(['runs', 'admin']))
    .min(1)
    .default(['runs']),
});
export const CreateApiKeyResponse = z.object({ id: z.string(), prefix: z.string(), key: z.string() });

/** GET /v1/me — the team and scopes behind the calling API key. */
export const MeResponse = z.object({ team: Team, scopes: z.array(z.string()) });
export type MeResponse = z.infer<typeof MeResponse>;
