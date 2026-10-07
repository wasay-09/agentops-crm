import type { Approval, RunDetail, WorkflowRun } from '@agentops/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type ApprovalRow, type RunRepository, toApproval } from '../agents/repo.js';
import type { AgentRuntime } from '../agents/runtime.js';
import type { Db } from '../db/client.js';
import { approvals } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import type { WorkflowEngine } from '../workflows/engine.js';

export class ApprovalService {
  constructor(
    private readonly db: Db,
    private readonly runtime: AgentRuntime,
    private readonly workflows: WorkflowEngine,
    private readonly runs: RunRepository,
  ) {}

  async list(
    teamId: string,
    status: 'pending' | 'approved' | 'rejected',
    limit: number,
  ): Promise<Approval[]> {
    const rows = await this.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.teamId, teamId), eq(approvals.status, status)))
      .orderBy(desc(approvals.createdAt))
      .limit(limit);
    return rows.map(toApproval);
  }

  /**
   * Record a decision exactly once (conditional update on status = pending), then hand it to the
   * run or workflow that is waiting on it.
   */
  async decide(
    teamId: string,
    teamName: string,
    id: string,
    decision: 'approve' | 'reject',
    decidedBy: string,
    note?: string,
  ): Promise<{ approval: Approval; run: RunDetail | null; workflowRun: WorkflowRun | null }> {
    const [updated] = await this.db
      .update(approvals)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedBy,
        note: note ?? null,
        decidedAt: sql`now()`,
      })
      .where(and(eq(approvals.id, id), eq(approvals.teamId, teamId), eq(approvals.status, 'pending')))
      .returning();
    if (!updated) {
      const [existing] = await this.db
        .select()
        .from(approvals)
        .where(and(eq(approvals.id, id), eq(approvals.teamId, teamId)));
      if (!existing) throw notFound('Approval');
      throw conflict(`Approval was already ${existing.status}`, 'already_decided');
    }

    await this.dispatch(updated, teamName);
    const [fresh] = await this.db.select().from(approvals).where(eq(approvals.id, id));
    return {
      approval: toApproval(fresh!),
      run: updated.runId ? await this.runs.detail(updated.runId) : null,
      workflowRun: updated.workflowRunId ? await this.workflows.get(updated.workflowRunId) : null,
    };
  }

  private async dispatch(approval: ApprovalRow, teamName: string): Promise<void> {
    if (approval.kind === 'tool_call') await this.runtime.resolveToolApproval(approval, teamName);
    else await this.workflows.resolveStepApproval(approval, teamName);
  }
}
