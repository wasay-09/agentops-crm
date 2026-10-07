import { randomUUID } from 'node:crypto';
import { isToolName, type RunDetail, TOOL_CONTRACTS } from '@agentops/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { approvals, runs, toolCalls } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { PromptRegistry } from '../prompts/registry.js';
import { PromptRenderError, renderTemplate } from '../prompts/render.js';
import type { ChatMessage, ToolCallRequest } from '../providers/types.js';
import type { Catalog } from '../routing/catalog.js';
import type { LlmService } from '../routing/llm-service.js';
import { currentTraceId, withSpan } from '../telemetry.js';
import { type ToolExecutor, toolDefinitions } from '../tools/registry.js';
import { type ApprovalRow, type RunRepository, type RunRow } from './repo.js';
import { sanitizeOutput } from './sanitize.js';

export interface StartRunInput {
  teamId: string;
  teamName: string;
  agent: string;
  input: string;
  context?: Record<string, unknown>;
  actor?: string;
  idempotencyKey?: string;
  workflowRunId?: string;
  faultModel?: string;
}

/** Run failures that surface as HTTP errors on POST /v1/runs (the run is still recorded as failed). */
const HTTP_FAILURES: Record<string, number> = {
  budget_exceeded: 402,
  upstream_unavailable: 502,
  no_model_available: 503,
};

const MAX_TOOL_RESULT_CHARS = 12_000;

/**
 * The agent loop. Deliberately a hand-written loop rather than an SDK tool runner: runs must pause
 * across HTTP requests while a person approves a write, and must work across providers.
 *
 *   call model → text only? done.
 *              → tool calls: validate args; read tools run now; write tools create an approval and pause.
 *   approval decided → execute (or record the rejection) → when nothing is pending, continue the loop.
 *
 * All state (messages, tool calls, approvals) is in Postgres, so a resume can happen on any instance.
 */
export class AgentRuntime {
  constructor(
    private readonly db: Db,
    private readonly repo: RunRepository,
    private readonly catalog: Catalog,
    private readonly prompts: PromptRegistry,
    private readonly llm: LlmService,
    private readonly tools: ToolExecutor,
    private readonly log: FastifyBaseLogger,
  ) {}

  async start(input: StartRunInput): Promise<RunDetail> {
    if (input.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(input.teamId, input.idempotencyKey);
      if (existing) return this.repo.detail(existing.id);
    }
    const agent = await this.catalog.agentEnabled(input.agent);
    if (!agent) throw new AppError(404, 'unknown_agent', `Agent "${input.agent}" not found or disabled`);

    const runId = randomUUID();
    const prompt = await this.prompts.resolve(agent.promptName, input.idempotencyKey ?? runId);
    let system: string;
    try {
      system = renderTemplate(prompt.template, {
        today: new Date().toISOString().slice(0, 10),
        context: input.context && Object.keys(input.context).length > 0 ? input.context : 'none',
        agent_name: agent.name,
      });
    } catch (err) {
      if (err instanceof PromptRenderError) throw new AppError(500, 'prompt_render_failed', err.message);
      throw err;
    }

    return withSpan(
      'agent.run',
      { 'agentops.agent': agent.slug, 'agentops.run_id': runId, 'agentops.prompt_version': prompt.version },
      async () => {
        try {
          await this.db.insert(runs).values({
            id: runId,
            teamId: input.teamId,
            agentSlug: agent.slug,
            taskType: agent.taskType,
            status: 'running',
            input: input.input,
            context: input.context ?? null,
            actor: input.actor ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            systemPrompt: system,
            promptVersionId: prompt.versionId,
            promptVersion: prompt.version,
            traceId: currentTraceId(),
            workflowRunId: input.workflowRunId ?? null,
          });
        } catch (err) {
          // Two concurrent requests with the same idempotency key: the loser returns the winner's run.
          if (input.idempotencyKey && isUniqueViolation(err)) {
            const existing = await this.repo.findByIdempotencyKey(input.teamId, input.idempotencyKey);
            if (existing) return this.repo.detail(existing.id);
          }
          throw err;
        }
        await this.repo.appendMessages(runId, [{ role: 'user', content: input.input }]);
        await this.loop(runId, input.teamName, input.faultModel);

        const detail = await this.repo.detail(runId);
        const status = detail.error ? HTTP_FAILURES[detail.error] : undefined;
        if (detail.status === 'failed' && status) {
          throw new AppError(status, detail.error!, `Run ${runId} failed: ${detail.error}`);
        }
        return detail;
      },
    );
  }

  /** Apply a decision on a tool-call approval and resume the run when nothing else is pending. */
  async resolveToolApproval(approval: ApprovalRow, teamName: string): Promise<void> {
    if (!approval.toolCallId || !approval.runId) throw new Error('approval is not linked to a tool call');
    const runId = approval.runId;
    const [tc] = await this.db.select().from(toolCalls).where(eq(toolCalls.id, approval.toolCallId));
    if (!tc) throw notFound('Tool call');

    let message: ChatMessage;
    if (approval.status === 'approved' && isToolName(tc.toolName)) {
      const t0 = performance.now();
      const res = await withSpan(
        'tool.call',
        { 'agentops.tool': tc.toolName, 'agentops.approved_by': approval.decidedBy ?? undefined },
        () =>
          this.tools.execute(tc.toolName as never, tc.args, {
            runId,
            teamName,
            actor: approval.decidedBy ?? undefined,
          }),
      );
      const result = res.ok ? res.data : { error: res.code, message: res.message };
      await this.db
        .update(toolCalls)
        .set({
          status: res.ok ? 'approved' : 'failed',
          result,
          latencyMs: Math.round(performance.now() - t0),
          completedAt: new Date(),
        })
        .where(eq(toolCalls.id, tc.id));
      message = {
        role: 'tool',
        toolCallId: tc.providerCallId,
        name: tc.toolName,
        content: truncate(JSON.stringify(result)),
        isError: !res.ok,
      };
    } else {
      const result = { rejected: true, by: approval.decidedBy, note: approval.note };
      await this.db
        .update(toolCalls)
        .set({ status: 'rejected', result, completedAt: new Date() })
        .where(eq(toolCalls.id, tc.id));
      message = {
        role: 'tool',
        toolCallId: tc.providerCallId,
        name: tc.toolName,
        content: JSON.stringify({
          ...result,
          message: 'A reviewer rejected this action; it was not performed.',
        }),
        isError: true,
      };
    }

    // Serialize resumes per run: lock the run row, append the result, and only the caller that flips
    // awaiting_approval → running continues the loop.
    const resume = await this.db.transaction(async (tx) => {
      await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).for('update');
      await this.repo.appendMessages(runId, [message], tx);
      const [pending] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(toolCalls)
        .where(and(eq(toolCalls.runId, runId), eq(toolCalls.status, 'pending_approval')));
      if ((pending?.n ?? 0) > 0) return false;
      const flipped = await tx
        .update(runs)
        .set({ status: 'running' })
        .where(and(eq(runs.id, runId), eq(runs.status, 'awaiting_approval')))
        .returning({ id: runs.id });
      return flipped.length > 0;
    });

    if (resume) {
      await withSpan('agent.resume', { 'agentops.run_id': runId }, () => this.loop(runId, teamName));
    }
  }

  private async loop(runId: string, teamName: string, faultModel?: string): Promise<void> {
    const run = await this.repo.get(runId);
    const agent = await this.catalog.agent(run.agentSlug);
    if (!agent?.enabled) return this.fail(run, 'agent_disabled');
    const tools = toolDefinitions(agent.tools);
    const messages = await this.repo.messages(runId);
    let step = run.step;
    let lastText = '';

    while (step < agent.maxSteps) {
      step += 1;
      let result: Awaited<ReturnType<LlmService['call']>>;
      try {
        result = await this.llm.call({
          teamId: run.teamId,
          taskType: agent.taskType,
          system: run.systemPrompt,
          messages: [...messages],
          tools,
          runId,
          agentSlug: agent.slug,
          step,
          promptVersionId: run.promptVersionId,
          faultModel,
        });
      } catch (err) {
        await this.repo.update(runId, { step });
        if (err instanceof AppError) return this.fail(run, err.code);
        this.log.error({ err, runId }, 'llm call crashed');
        return this.fail(run, 'internal_error');
      }

      const { response } = result;
      const assistant: ChatMessage = {
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
        native: response.native,
      };
      messages.push(assistant);
      await this.repo.appendMessages(runId, [assistant]);
      await this.repo.update(runId, { step });
      lastText = sanitizeOutput(response.text);

      if (response.stopReason === 'refusal') return this.fail(run, 'refused', lastText || null);
      if (response.toolCalls.length === 0) {
        if (response.stopReason === 'max_tokens' && !lastText) return this.fail(run, 'max_tokens');
        await this.repo.update(runId, {
          status: 'completed',
          output: lastText || '(no answer)',
          completedAt: new Date(),
        });
        return;
      }

      let pending = 0;
      for (const call of response.toolCalls) {
        const outcome = await this.handleToolCall(run, agent.tools, step, call, teamName);
        if (outcome === null) pending += 1;
        else {
          messages.push(outcome);
          await this.repo.appendMessages(runId, [outcome]);
        }
      }
      if (pending > 0) {
        await this.repo.update(runId, { status: 'awaiting_approval', output: lastText || null });
        return;
      }
    }
    return this.fail(run, 'max_steps_exceeded', lastText || null);
  }

  /** Returns the tool-result message, or null when the call is waiting for approval. */
  private async handleToolCall(
    run: RunRow,
    allowed: string[],
    step: number,
    call: ToolCallRequest,
    teamName: string,
  ): Promise<ChatMessage | null> {
    const base = { runId: run.id, step, providerCallId: call.id, toolName: call.name };
    const errorMessage = (content: string): ChatMessage => ({
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content,
      isError: true,
    });

    if (!isToolName(call.name) || !allowed.includes(call.name)) {
      await this.db.insert(toolCalls).values({
        ...base,
        mode: 'read',
        args: call.args,
        status: 'failed',
        result: { error: 'unknown_tool' },
        completedAt: new Date(),
      });
      return errorMessage(`Tool "${call.name}" is not available to this agent.`);
    }
    const contract = TOOL_CONTRACTS[call.name];
    const parsed = contract.args.safeParse(call.args);
    if (!parsed.success) {
      const issues = z.prettifyError(parsed.error);
      await this.db.insert(toolCalls).values({
        ...base,
        mode: contract.mode,
        args: call.args,
        status: 'invalid_args',
        result: { error: issues },
        completedAt: new Date(),
      });
      return errorMessage(`Invalid arguments for ${call.name}: ${issues}`);
    }

    if (contract.mode === 'write') {
      await this.db.transaction(async (tx) => {
        const [tc] = await tx
          .insert(toolCalls)
          .values({ ...base, mode: 'write', args: parsed.data, status: 'pending_approval' })
          .returning({ id: toolCalls.id });
        await tx.insert(approvals).values({
          teamId: run.teamId,
          kind: 'tool_call',
          title: describeWrite(call.name, parsed.data as Record<string, unknown>),
          payload: { tool: call.name, args: parsed.data },
          runId: run.id,
          toolCallId: tc!.id,
          requestedBy: run.actor,
        });
      });
      return null;
    }

    const t0 = performance.now();
    const res = await withSpan('tool.call', { 'agentops.tool': call.name, 'agentops.run_id': run.id }, () =>
      this.tools.execute(call.name as never, parsed.data, { runId: run.id, teamName }),
    );
    const result = res.ok ? res.data : { error: res.code, message: res.message };
    await this.db.insert(toolCalls).values({
      ...base,
      mode: 'read',
      args: parsed.data,
      status: res.ok ? 'executed' : 'failed',
      result,
      latencyMs: Math.round(performance.now() - t0),
      completedAt: new Date(),
    });
    return {
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: truncate(JSON.stringify(result)),
      isError: !res.ok,
    };
  }

  private async fail(run: RunRow, code: string, output: string | null = null): Promise<void> {
    await this.repo.update(run.id, { status: 'failed', error: code, output, completedAt: new Date() });
  }
}

function describeWrite(tool: string, args: Record<string, unknown>): string {
  if (tool === 'add_note') return `Add note to contact #${args.contactId}`;
  if (tool === 'move_deal_stage') return `Move deal #${args.dealId} to ${args.stage}`;
  return `Run ${tool}`;
}

function truncate(s: string): string {
  return s.length <= MAX_TOOL_RESULT_CHARS ? s : `${s.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)`;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
