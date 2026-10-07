import type {
  Approval,
  LlmCall,
  RoutingReason,
  RunDetail,
  RunStatus,
  RunSummary,
  TimelineEvent,
  ToolCall,
  ToolCallStatus,
} from '@agentops/contracts';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { approvals, llmCalls, runMessages, runs, toolCalls } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import type { ChatMessage } from '../providers/types.js';

export type RunRow = typeof runs.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toApproval(a: ApprovalRow): Approval {
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    title: a.title,
    payload: a.payload,
    runId: a.runId,
    workflowRunId: a.workflowRunId,
    requestedBy: a.requestedBy,
    decidedBy: a.decidedBy,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
    decidedAt: iso(a.decidedAt),
  };
}

export class RunRepository {
  constructor(private readonly db: Db) {}

  async get(runId: string, teamId?: string): Promise<RunRow> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(teamId ? and(eq(runs.id, runId), eq(runs.teamId, teamId)) : eq(runs.id, runId));
    if (!row) throw notFound('Run');
    return row;
  }

  async findByIdempotencyKey(teamId: string, key: string): Promise<RunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.teamId, teamId), eq(runs.idempotencyKey, key)));
    return row;
  }

  async messages(runId: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select()
      .from(runMessages)
      .where(eq(runMessages.runId, runId))
      .orderBy(asc(runMessages.seq));
    return rows.map((r) => r.message as ChatMessage);
  }

  async appendMessages(runId: string, messages: ChatMessage[], tx: Db | Tx = this.db): Promise<void> {
    if (messages.length === 0) return;
    const [{ last } = { last: null }] = await tx
      .select({ last: max(runMessages.seq) })
      .from(runMessages)
      .where(eq(runMessages.runId, runId));
    const start = (last ?? -1) + 1;
    await tx.insert(runMessages).values(messages.map((message, i) => ({ runId, seq: start + i, message })));
  }

  async update(
    runId: string,
    patch: Partial<typeof runs.$inferInsert>,
    tx: Db | Tx = this.db,
  ): Promise<void> {
    await tx.update(runs).set(patch).where(eq(runs.id, runId));
  }

  async list(
    teamId: string,
    q: { agent?: string; status?: RunStatus; limit: number },
  ): Promise<RunSummary[]> {
    const conds = [eq(runs.teamId, teamId)];
    if (q.agent) conds.push(eq(runs.agentSlug, q.agent));
    if (q.status) conds.push(eq(runs.status, q.status));
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(...conds))
      .orderBy(desc(runs.createdAt))
      .limit(q.limit);
    const totals = await this.totals(rows.map((r) => r.id));
    return rows.map((r) => this.summary(r, totals.get(r.id)));
  }

  async detail(runId: string, teamId?: string): Promise<RunDetail> {
    const run = await this.get(runId, teamId);
    const [calls, tools, apps] = await Promise.all([
      this.db
        .select()
        .from(llmCalls)
        .where(eq(llmCalls.runId, runId))
        .orderBy(asc(llmCalls.step), asc(llmCalls.attempt)),
      this.db.select().from(toolCalls).where(eq(toolCalls.runId, runId)).orderBy(asc(toolCalls.startedAt)),
      this.db.select().from(approvals).where(eq(approvals.runId, runId)).orderBy(asc(approvals.createdAt)),
    ]);

    const llm: LlmCall[] = calls.map((c) => ({
      id: c.id,
      step: c.step,
      attempt: c.attempt,
      provider: c.provider,
      model: c.model,
      routingReason: c.routingReason as RoutingReason,
      status: c.status,
      errorCode: c.errorCode,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      costUsd: c.costUsd,
      latencyMs: c.latencyMs,
      promptVersion: run.promptVersion,
      startedAt: c.startedAt.toISOString(),
    }));
    const toolDtos: ToolCall[] = tools.map((t) => ({
      id: t.id,
      step: t.step,
      toolName: t.toolName,
      mode: t.mode,
      args: t.args,
      result: t.result ?? null,
      status: t.status as ToolCallStatus,
      latencyMs: t.latencyMs,
      startedAt: t.startedAt.toISOString(),
    }));
    const approvalDtos = apps.map(toApproval);

    const timeline: TimelineEvent[] = [
      ...calls.map((c) => ({
        kind: 'llm' as const,
        label: `${c.model} (step ${c.step}${c.attempt > 1 ? `, attempt ${c.attempt}` : ''})`,
        startedAt: c.startedAt.toISOString(),
        durationMs: c.latencyMs,
        status: c.status,
        detail:
          c.status === 'ok'
            ? `${c.inputTokens}→${c.outputTokens} tokens · $${c.costUsd.toFixed(6)} · ${c.routingReason}`
            : `${c.errorCode} · ${c.routingReason}`,
      })),
      ...tools.map((t) => ({
        kind: 'tool' as const,
        label: t.toolName,
        startedAt: t.startedAt.toISOString(),
        durationMs: t.latencyMs,
        status: t.status,
        detail: JSON.stringify(t.args),
      })),
      ...apps.map((a) => ({
        kind: 'approval' as const,
        label: a.title,
        startedAt: a.createdAt.toISOString(),
        durationMs: a.decidedAt ? a.decidedAt.getTime() - a.createdAt.getTime() : null,
        status: a.status,
        detail: a.decidedBy ? `by ${a.decidedBy}${a.note ? `: ${a.note}` : ''}` : undefined,
      })),
    ].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    const totals = { cost: 0, tokens: 0 };
    for (const c of calls) {
      totals.cost += c.costUsd;
      totals.tokens += c.inputTokens + c.outputTokens;
    }
    return {
      ...this.summary(run, totals),
      llmCalls: llm,
      toolCalls: toolDtos,
      approvals: approvalDtos,
      timeline,
    };
  }

  private async totals(runIds: string[]): Promise<Map<string, { cost: number; tokens: number }>> {
    if (runIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        runId: llmCalls.runId,
        cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
        tokens: sql<number>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens}), 0)::int`,
      })
      .from(llmCalls)
      .where(inArray(llmCalls.runId, runIds))
      .groupBy(llmCalls.runId);
    return new Map(rows.map((r) => [r.runId!, { cost: r.cost, tokens: r.tokens }]));
  }

  private summary(r: RunRow, totals: { cost: number; tokens: number } = { cost: 0, tokens: 0 }): RunSummary {
    return {
      id: r.id,
      agent: r.agentSlug,
      status: r.status as RunStatus,
      input: r.input,
      output: r.output,
      error: r.error,
      promptVersion: r.promptVersion,
      totalCostUsd: Math.round(totals.cost * 1e6) / 1e6,
      totalTokens: totals.tokens,
      traceId: r.traceId,
      workflowRunId: r.workflowRunId,
      actor: r.actor,
      createdAt: r.createdAt.toISOString(),
      completedAt: iso(r.completedAt),
    };
  }
}
