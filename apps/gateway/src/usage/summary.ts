import type { RoutingReason, UsageSummary } from '@agentops/contracts';
import { sql } from 'drizzle-orm';
import type { BudgetService } from '../budget/budget.js';
import type { Db } from '../db/client.js';

const round = (n: number | null | undefined, digits = 6) => {
  const f = 10 ** digits;
  return Math.round((n ?? 0) * f) / f;
};

/** Dashboard metrics straight from the ledger. Errors count failed attempts, including ones a fallback recovered. */
export class UsageService {
  constructor(
    private readonly db: Db,
    private readonly budget: BudgetService,
  ) {}

  async summary(team: { id: string; name: string }, days: number): Promise<UsageSummary> {
    const since = sql`now() - make_interval(days => ${days})`;
    const scope = sql`team_id = ${team.id} and started_at >= ${since}`;

    const [totals, byDay, byAgent, byModel, byPrompt, reasons, runCount, budget] = await Promise.all([
      this.rows<{
        cost: number;
        calls: number;
        input: number;
        output: number;
        errors: number;
        p95: number | null;
      }>(sql`
        select coalesce(sum(cost_usd), 0) as cost, count(*)::int as calls,
               coalesce(sum(input_tokens), 0)::int as input, coalesce(sum(output_tokens), 0)::int as output,
               count(*) filter (where status = 'error')::int as errors,
               percentile_cont(0.95) within group (order by latency_ms) as p95
        from llm_calls where ${scope}`),
      this.rows<{ day: string; agent: string; cost: number; calls: number }>(sql`
        select to_char(date_trunc('day', started_at), 'YYYY-MM-DD') as day, coalesce(agent_slug, '(direct)') as agent,
               coalesce(sum(cost_usd), 0) as cost, count(*)::int as calls
        from llm_calls where ${scope} group by 1, 2 order by 1, 2`),
      this.rows<{ agent: string; calls: number; cost: number; p95: number | null; errors: number }>(sql`
        select coalesce(agent_slug, '(direct)') as agent, count(*)::int as calls, coalesce(sum(cost_usd), 0) as cost,
               percentile_cont(0.95) within group (order by latency_ms) as p95,
               count(*) filter (where status = 'error')::int as errors
        from llm_calls where ${scope} group by 1 order by cost desc`),
      this.rows<{ model: string; calls: number; cost: number; p95: number | null; errors: number }>(sql`
        select model, count(*)::int as calls, coalesce(sum(cost_usd), 0) as cost,
               percentile_cont(0.95) within group (order by latency_ms) as p95,
               count(*) filter (where status = 'error')::int as errors
        from llm_calls where ${scope} group by 1 order by cost desc`),
      this.rows<{
        prompt: string;
        version: number;
        runs: number;
        avg_cost: number;
        avg_latency: number | null;
      }>(sql`
        with run_cost as (
          select r.id, r.prompt_version_id,
                 -- model time, not wall time: excludes time spent waiting for a human approval
                 coalesce((select sum(c.latency_ms) from llm_calls c where c.run_id = r.id), 0) as latency,
                 coalesce((select sum(c.cost_usd) from llm_calls c where c.run_id = r.id), 0) as cost
          from runs r where r.team_id = ${team.id} and r.created_at >= ${since} and r.status = 'completed'
        )
        select p.name as prompt, v.version, count(*)::int as runs, avg(rc.cost) as avg_cost, avg(rc.latency) as avg_latency
        from run_cost rc join prompt_versions v on v.id = rc.prompt_version_id join prompts p on p.id = v.prompt_id
        group by 1, 2 order by 1, 2`),
      this.rows<{ reason: RoutingReason; calls: number }>(sql`
        select routing_reason as reason, count(*)::int as calls from llm_calls where ${scope} group by 1 order by 2 desc`),
      this.rows<{ n: number }>(
        sql`select count(*)::int as n from runs where team_id = ${team.id} and created_at >= ${since}`,
      ),
      this.budget.status(team.id),
    ]);

    const t = totals[0] ?? { cost: 0, calls: 0, input: 0, output: 0, errors: 0, p95: 0 };
    return {
      team,
      rangeDays: days,
      totals: {
        costUsd: round(t.cost),
        calls: t.calls,
        runs: runCount[0]?.n ?? 0,
        inputTokens: t.input,
        outputTokens: t.output,
        errorRate: t.calls ? round(t.errors / t.calls, 4) : 0,
        p95LatencyMs: Math.round(t.p95 ?? 0),
      },
      budget,
      costByDayAgent: byDay.map((r) => ({
        day: r.day,
        agent: r.agent,
        costUsd: round(r.cost),
        calls: r.calls,
      })),
      byAgent: byAgent.map((r) => ({
        agent: r.agent,
        calls: r.calls,
        costUsd: round(r.cost),
        p95LatencyMs: Math.round(r.p95 ?? 0),
        errorRate: r.calls ? round(r.errors / r.calls, 4) : 0,
      })),
      byModel: byModel.map((r) => ({
        model: r.model,
        calls: r.calls,
        costUsd: round(r.cost),
        p95LatencyMs: Math.round(r.p95 ?? 0),
        errorRate: r.calls ? round(r.errors / r.calls, 4) : 0,
      })),
      byPromptVersion: byPrompt.map((r) => ({
        prompt: r.prompt,
        version: r.version,
        runs: r.runs,
        avgCostUsd: round(r.avg_cost),
        avgLatencyMs: Math.round(r.avg_latency ?? 0),
      })),
      routingReasons: reasons,
    };
  }

  private async rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
    const res = await this.db.execute(query);
    return res.rows as T[];
  }
}
