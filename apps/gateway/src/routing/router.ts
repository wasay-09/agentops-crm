import type { BudgetState, RoutingReason } from '@agentops/contracts';
import { AppError } from '../lib/errors.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ModelSpec } from '../providers/types.js';
import type { CircuitBreaker } from './breaker.js';
import type { Catalog } from './catalog.js';

export interface Candidate {
  model: ModelSpec;
  reason: RoutingReason;
}

export interface RoutePlan {
  candidates: Candidate[];
  maxOutputTokens: number;
  /** Models dropped from the chain and why — logged and attached to the trace. */
  skipped: { model: string; why: 'disabled' | 'unconfigured' | 'circuit_open' | 'unknown' }[];
}

/** A simulated stand-in for a real model: same name, same prices, served by the mock provider. */
export function mockOf(model: ModelSpec): ModelSpec {
  return { ...model, id: `mock:${model.modelName}`, provider: 'mock', params: {} };
}

/**
 * Turns a task type into an ordered list of models to try.
 *
 * 1. Start from the policy chain for the task type.
 * 2. Over the soft budget limit → the policy's cheaper budget model goes first (`budget_downgrade`).
 * 3. Drop models that are disabled, whose provider has no credentials, or whose circuit is open.
 * 4. With mock fallback on: if nothing real is left, simulate the whole chain with the mock provider
 *    (keeping the routing reasons); otherwise append a simulated primary as a last resort (`mock_fallback`).
 */
export class Router {
  constructor(
    private readonly catalog: Catalog,
    private readonly providers: ProviderRegistry,
    private readonly breaker: CircuitBreaker,
    private readonly opts: { mockFallback: boolean },
  ) {}

  async plan(taskType: string, budget: BudgetState): Promise<RoutePlan> {
    const policy = await this.catalog.policy(taskType);
    if (!policy)
      throw new AppError(400, 'unknown_task_type', `No routing policy for task type "${taskType}"`);

    const ordered: { id: string; reason: RoutingReason }[] = [];
    if (budget === 'soft' && policy.budgetModel)
      ordered.push({ id: policy.budgetModel, reason: 'budget_downgrade' });
    policy.chain.forEach((id, i) => {
      if (!ordered.some((o) => o.id === id))
        ordered.push({ id, reason: i === 0 && ordered.length === 0 ? 'primary' : 'fallback' });
    });

    const skipped: RoutePlan['skipped'] = [];
    const known: Candidate[] = [];
    const real: Candidate[] = [];
    for (const o of ordered) {
      const m = await this.catalog.model(o.id);
      if (!m) {
        skipped.push({ model: o.id, why: 'unknown' });
        continue;
      }
      if (!m.enabled) {
        skipped.push({ model: o.id, why: 'disabled' });
        continue;
      }
      const spec: ModelSpec = {
        id: m.id,
        provider: m.provider,
        modelName: m.modelName,
        tier: m.tier,
        inputUsdPerMTok: m.inputUsdPerMTok,
        outputUsdPerMTok: m.outputUsdPerMTok,
        params: m.params,
      };
      known.push({ model: spec, reason: o.reason });
      if (!this.providers.isAvailable(m.provider)) {
        skipped.push({ model: o.id, why: 'unconfigured' });
        continue;
      }
      if (this.breaker.isOpen(m.id)) {
        skipped.push({ model: o.id, why: 'circuit_open' });
        continue;
      }
      real.push({ model: spec, reason: o.reason });
    }

    let candidates = real;
    if (this.opts.mockFallback && known.length > 0) {
      if (real.length === 0) {
        candidates = known
          .map((c) => ({ model: mockOf(c.model), reason: c.reason }))
          .filter((c) => !this.breaker.isOpen(c.model.id));
      } else {
        const primary = known.find((c) => c.reason !== 'budget_downgrade') ?? known[0]!;
        const sim = mockOf(primary.model);
        if (!this.breaker.isOpen(sim.id)) candidates = [...real, { model: sim, reason: 'mock_fallback' }];
      }
    }

    return { candidates, maxOutputTokens: policy.maxOutputTokens, skipped };
  }
}
