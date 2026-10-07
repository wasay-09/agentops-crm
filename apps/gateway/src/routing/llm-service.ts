import type { RoutingReason } from '@agentops/contracts';
import type { FastifyBaseLogger } from 'fastify';
import type { BudgetService } from '../budget/budget.js';
import { AppError } from '../lib/errors.js';
import type { ProviderRegistry } from '../providers/registry.js';
import {
  type ChatMessage,
  type ChatResponse,
  costUsd,
  estimateRequestTokens,
  type ModelSpec,
  ProviderError,
  type ToolDefinition,
} from '../providers/types.js';
import { currentTraceId, withSpan } from '../telemetry.js';
import type { Ledger } from '../usage/ledger.js';
import type { CircuitBreaker } from './breaker.js';
import type { Router } from './router.js';

export interface LlmCallInput {
  teamId: string;
  taskType: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  runId?: string;
  agentSlug?: string;
  step: number;
  promptVersionId?: string | null;
  maxTokens?: number;
  /** Fault injection (dev/demo): force a retryable failure on this model id or name. */
  faultModel?: string;
}

export interface LlmCallResult {
  response: ChatResponse;
  model: ModelSpec;
  routingReason: RoutingReason;
  costUsd: number;
  latencyMs: number;
  attempts: number;
}

const RETRY_BASE_MS = 150;

/**
 * One routed LLM call: budget check → route → (reserve → call → settle) per attempt, with one quick
 * retry on the same model for transient errors, then fallback down the chain. Every attempt is a ledger row.
 */
export class LlmService {
  constructor(
    private readonly router: Router,
    private readonly providers: ProviderRegistry,
    private readonly breaker: CircuitBreaker,
    private readonly budget: BudgetService,
    private readonly ledger: Ledger,
    private readonly log: FastifyBaseLogger,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async call(input: LlmCallInput): Promise<LlmCallResult> {
    const budget = await this.budget.status(input.teamId);
    if (budget.state === 'hard')
      throw new AppError(402, 'budget_exceeded', 'Team budget exhausted for this month');

    const plan = await this.router.plan(input.taskType, budget.state);
    if (plan.skipped.length > 0)
      this.log.debug({ skipped: plan.skipped, taskType: input.taskType }, 'routing skipped models');
    if (plan.candidates.length === 0)
      throw new AppError(503, 'no_model_available', 'No model is available for this task');

    const maxTokens = Math.min(input.maxTokens ?? plan.maxOutputTokens, plan.maxOutputTokens);
    const estimatedInput = estimateRequestTokens(input);
    let attempt = 0;
    let lastError: ProviderError | null = null;

    for (const candidate of plan.candidates) {
      for (let tryNo = 0; tryNo < 2; tryNo++) {
        attempt += 1;
        const worstCase = costUsd(candidate.model, estimatedInput, maxTokens);
        const reservationId = await this.budget.reserve(input.teamId, worstCase);
        const startedAt = new Date();
        const t0 = performance.now();

        try {
          const response = await withSpan(
            'llm.call',
            {
              'gen_ai.system': candidate.model.provider,
              'gen_ai.request.model': candidate.model.modelName,
              'gen_ai.request.max_tokens': maxTokens,
              'agentops.routing_reason': candidate.reason,
              'agentops.attempt': attempt,
              'agentops.task_type': input.taskType,
              'agentops.agent': input.agentSlug,
            },
            async (span) => {
              if (this.isFaulted(input.faultModel, candidate.model)) {
                throw new ProviderError('Injected fault', 'injected_fault', true, 503);
              }
              const provider = this.providers.get(candidate.model.provider);
              if (!provider)
                throw new ProviderError(
                  `Unknown provider ${candidate.model.provider}`,
                  'unknown_provider',
                  false,
                );
              const res = await provider.chat({
                model: candidate.model,
                system: input.system,
                messages: input.messages,
                tools: input.tools,
                maxTokens,
              });
              span.setAttribute('gen_ai.usage.input_tokens', res.usage.inputTokens);
              span.setAttribute('gen_ai.usage.output_tokens', res.usage.outputTokens);
              span.setAttribute('gen_ai.response.finish_reasons', [res.stopReason]);
              return res;
            },
          );
          const latencyMs = Math.round(performance.now() - t0);
          const cost = costUsd(candidate.model, response.usage.inputTokens, response.usage.outputTokens);
          await this.ledger.settle(
            {
              teamId: input.teamId,
              runId: input.runId,
              agentSlug: input.agentSlug,
              taskType: input.taskType,
              step: input.step,
              attempt,
              provider: candidate.model.provider,
              model: candidate.model.id,
              routingReason: candidate.reason,
              status: 'ok',
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              costUsd: cost,
              latencyMs,
              promptVersionId: input.promptVersionId ?? null,
              traceId: currentTraceId(),
              startedAt,
            },
            reservationId,
          );
          this.breaker.recordSuccess(candidate.model.id);
          return {
            response,
            model: candidate.model,
            routingReason: candidate.reason,
            costUsd: cost,
            latencyMs,
            attempts: attempt,
          };
        } catch (err) {
          const perr =
            err instanceof ProviderError
              ? err
              : new ProviderError(err instanceof Error ? err.message : String(err), 'unknown', false);
          lastError = perr;
          await this.ledger.settle(
            {
              teamId: input.teamId,
              runId: input.runId,
              agentSlug: input.agentSlug,
              taskType: input.taskType,
              step: input.step,
              attempt,
              provider: candidate.model.provider,
              model: candidate.model.id,
              routingReason: candidate.reason,
              status: 'error',
              errorCode: perr.code,
              latencyMs: Math.round(performance.now() - t0),
              promptVersionId: input.promptVersionId ?? null,
              traceId: currentTraceId(),
              startedAt,
            },
            reservationId,
          );
          this.breaker.recordFailure(candidate.model.id);
          this.log.warn(
            { model: candidate.model.id, code: perr.code, status: perr.status, attempt },
            'llm attempt failed',
          );
          if (!perr.retryable || tryNo === 1 || this.breaker.isOpen(candidate.model.id)) break;
          await this.sleep(RETRY_BASE_MS * (1 + Math.random()));
        }
      }
    }

    throw new AppError(
      502,
      'upstream_unavailable',
      `All models failed for this task (last error: ${lastError?.code ?? 'unknown'})`,
    );
  }

  private isFaulted(fault: string | undefined, model: ModelSpec): boolean {
    if (!fault) return false;
    return fault.split(',').some((f) => f.trim() === model.id || f.trim() === model.modelName);
  }
}
