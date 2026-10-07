import { TOOL_CONTRACTS, type WorkflowRun, type WorkflowStatus } from '@agentops/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { ApprovalRow } from '../agents/repo.js';
import type { AgentRuntime } from '../agents/runtime.js';
import type { Db } from '../db/client.js';
import { approvals, type WorkflowStepRow, workflowRuns } from '../db/schema.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import type { Catalog } from '../routing/catalog.js';
import { withSpan } from '../telemetry.js';
import type { ToolExecutor } from '../tools/registry.js';
import { WORKFLOWS, type WorkflowContext, type WorkflowDefinition } from './definitions.js';

type WorkflowRow = typeof workflowRuns.$inferSelect;

/**
 * Runs workflow definitions step by step, persisting state after every step so a run can stop at an
 * approval and resume later (on any instance). Agent steps use idempotency keys derived from the
 * workflow run and step, so re-driving a step never starts a second agent run.
 */
export class WorkflowEngine {
  constructor(
    private readonly db: Db,
    private readonly runtime: AgentRuntime,
    private readonly tools: ToolExecutor,
    private readonly catalog: Catalog,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(
    teamId: string,
    teamName: string,
    name: string,
    input: Record<string, unknown>,
    actor?: string,
  ): Promise<WorkflowRun> {
    const def = WORKFLOWS[name];
    if (!def) throw new AppError(404, 'unknown_workflow', `Workflow "${name}" not found`);
    const parsed = def.input.safeParse(input);
    if (!parsed.success)
      throw badRequest(`Invalid workflow input: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    await this.assertAgentStepsAreReadOnly(def);

    const [row] = await this.db
      .insert(workflowRuns)
      .values({
        teamId,
        workflow: name,
        status: 'running',
        input: parsed.data,
        context: {},
        steps: def.steps.map((s) => ({
          id: s.id,
          type: s.type,
          label: s.label,
          status: 'pending',
          runId: null,
          approvalId: null,
          output: null,
        })),
        actor: actor ?? null,
      })
      .returning();
    await withSpan('workflow.run', { 'agentops.workflow': name, 'agentops.workflow_run_id': row!.id }, () =>
      this.advance(row!.id, teamName),
    );
    return this.get(row!.id);
  }

  async get(id: string, teamId?: string): Promise<WorkflowRun> {
    const [row] = await this.db
      .select()
      .from(workflowRuns)
      .where(
        teamId ? and(eq(workflowRuns.id, id), eq(workflowRuns.teamId, teamId)) : eq(workflowRuns.id, id),
      );
    if (!row) throw notFound('Workflow run');
    return toDto(row);
  }

  /** Called after a workflow-step approval is decided. */
  async resolveStepApproval(approval: ApprovalRow, teamName: string): Promise<void> {
    if (!approval.workflowRunId) throw new Error('approval is not linked to a workflow run');
    const row = await this.load(approval.workflowRunId);
    const steps = structuredClone(row.steps);
    const idx = steps.findIndex((s) => s.id === approval.workflowStepId);
    if (idx < 0) throw new Error('approval step not found');

    if (approval.status === 'rejected') {
      steps[idx] = {
        ...steps[idx]!,
        status: 'failed',
        output: { decision: 'rejected', by: approval.decidedBy, note: approval.note },
      };
      for (let i = idx + 1; i < steps.length; i++) steps[i] = { ...steps[i]!, status: 'skipped' };
      await this.save(
        row.id,
        {
          steps,
          status: 'cancelled',
          error: `Rejected by ${approval.decidedBy ?? 'reviewer'}`,
          completedAt: new Date(),
        },
        'awaiting_approval',
      );
      return;
    }

    steps[idx] = {
      ...steps[idx]!,
      status: 'completed',
      output: { decision: 'approved', by: approval.decidedBy, note: approval.note },
    };
    const context = { ...row.context, approvedBy: approval.decidedBy };
    const flipped = await this.save(
      row.id,
      { steps, context, currentStep: idx + 1, status: 'running' },
      'awaiting_approval',
    );
    if (flipped)
      await withSpan('workflow.resume', { 'agentops.workflow_run_id': row.id }, () =>
        this.advance(row.id, teamName),
      );
  }

  private async advance(id: string, teamName: string): Promise<void> {
    const row = await this.load(id);
    const def = WORKFLOWS[row.workflow]!;
    const steps = structuredClone(row.steps);
    const ctx: WorkflowContext = { ...row.context, input: row.input };
    const actor = (ctx.approvedBy as string | undefined) ?? row.actor ?? undefined;

    for (let i = row.currentStep; i < def.steps.length; i++) {
      const step = def.steps[i]!;
      const state = steps[i]!;
      if (step.when && !step.when(ctx)) {
        steps[i] = { ...state, status: 'skipped' };
        await this.save(id, { steps, currentStep: i + 1 });
        continue;
      }

      try {
        const output = await withSpan(
          'workflow.step',
          { 'agentops.step': step.id, 'agentops.step_type': step.type },
          async () => {
            if (step.type === 'approval') {
              const [approval] = await this.db
                .insert(approvals)
                .values({
                  teamId: row.teamId,
                  kind: 'workflow_step',
                  title: step.title(ctx),
                  payload: step.payload(ctx),
                  workflowRunId: id,
                  workflowStepId: step.id,
                  requestedBy: row.actor,
                })
                .returning({ id: approvals.id });
              steps[i] = { ...state, status: 'waiting', approvalId: approval!.id };
              return WAITING;
            }
            if (step.type === 'agent') {
              const run = await this.runtime.start({
                teamId: row.teamId,
                teamName,
                agent: step.agent,
                input: step.input(ctx),
                context: step.context?.(ctx),
                actor: row.actor ?? undefined,
                workflowRunId: id,
                idempotencyKey: `wf:${id}:${step.id}`,
              });
              steps[i] = { ...state, runId: run.id };
              if (run.status !== 'completed')
                throw new StepError(`${step.label} did not complete (${run.error ?? run.status})`);
              return run.output;
            }
            const res = await this.tools.execute(step.tool, step.args(ctx), { runId: id, teamName, actor });
            if (!res.ok) throw new StepError(`${step.label} failed: ${res.code}`);
            return res.data;
          },
        );

        if (output === WAITING) {
          await this.save(id, { steps, currentStep: i, status: 'awaiting_approval' });
          return;
        }
        steps[i] = { ...steps[i]!, status: 'completed', output };
        if (step.saveAs) ctx[step.saveAs] = output;
        const { input: _input, ...context } = ctx;
        await this.save(id, { steps, context, currentStep: i + 1 });
      } catch (err) {
        const message = err instanceof StepError || err instanceof AppError ? err.message : 'internal error';
        if (!(err instanceof StepError || err instanceof AppError))
          this.log.error({ err, workflowRunId: id }, 'workflow step crashed');
        steps[i] = { ...steps[i]!, status: 'failed' };
        await this.save(id, { steps, status: 'failed', error: message, completedAt: new Date() });
        return;
      }
    }
    await this.save(id, { steps, status: 'completed', completedAt: new Date() });
  }

  private async assertAgentStepsAreReadOnly(def: WorkflowDefinition): Promise<void> {
    for (const step of def.steps) {
      if (step.type !== 'agent') continue;
      const agent = await this.catalog.agentEnabled(step.agent);
      if (!agent)
        throw new AppError(409, 'workflow_misconfigured', `Agent "${step.agent}" is missing or disabled`);
      const writes = agent.tools.filter(
        (t) => TOOL_CONTRACTS[t as keyof typeof TOOL_CONTRACTS]?.mode === 'write',
      );
      if (writes.length > 0) {
        throw new AppError(
          409,
          'workflow_misconfigured',
          `Agent "${step.agent}" has write tools (${writes.join(', ')}); use an approval + tool step instead`,
        );
      }
    }
  }

  private async load(id: string): Promise<WorkflowRow> {
    const [row] = await this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    if (!row) throw notFound('Workflow run');
    return row;
  }

  /** Conditional on `expectedStatus` when given; returns whether the row was updated. */
  private async save(
    id: string,
    patch: Partial<typeof workflowRuns.$inferInsert> & { status?: WorkflowStatus },
    expectedStatus?: WorkflowStatus,
  ): Promise<boolean> {
    const where = expectedStatus
      ? and(eq(workflowRuns.id, id), eq(workflowRuns.status, expectedStatus))
      : eq(workflowRuns.id, id);
    const rows = await this.db
      .update(workflowRuns)
      .set(patch)
      .where(where)
      .returning({ id: workflowRuns.id });
    return rows.length > 0;
  }
}

const WAITING = Symbol('waiting');

class StepError extends Error {}

function toDto(row: WorkflowRow): WorkflowRun {
  return {
    id: row.id,
    workflow: row.workflow,
    status: row.status as WorkflowStatus,
    input: row.input,
    context: row.context,
    steps: row.steps.map((s: WorkflowStepRow) => ({ ...s, output: s.output ?? null })),
    error: row.error,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
