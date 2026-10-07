import type { BudgetState } from '@agentops/contracts';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { budgetReservations, llmCalls, teams } from '../db/schema.js';
import { BudgetExceededError, notFound } from '../lib/errors.js';

export interface BudgetStatus {
  state: BudgetState;
  monthlyLimitUsd: number;
  softLimitPct: number;
  monthToDateUsd: number;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const RESERVATION_TTL_SECONDS = 300;

/**
 * Monthly team budgets.
 *
 * Spend is the ledger's month-to-date total. Before each LLM call we reserve the call's worst-case
 * cost under a per-team advisory lock, so concurrent requests can't jointly overspend; after the call
 * the reservation is swapped for the real ledger row in one transaction (see Ledger.settle).
 * Reservations expire, so a crashed request can't hold budget forever.
 */
export class BudgetService {
  constructor(private readonly db: Db) {}

  async status(teamId: string): Promise<BudgetStatus> {
    return this.statusIn(this.db, teamId);
  }

  async reserve(teamId: string, amountUsd: number): Promise<string> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${teamId}))`);
      const s = await this.statusIn(tx, teamId);
      const [held] = await tx
        .select({ total: sql<number>`coalesce(sum(${budgetReservations.amountUsd}), 0)` })
        .from(budgetReservations)
        .where(and(eq(budgetReservations.teamId, teamId), gt(budgetReservations.expiresAt, sql`now()`)));
      // Bounded overdraft: a call may start while committed spend (ledger + in-flight reservations) is
      // under the limit. Its reservation then counts against everyone else, so total spend can exceed the
      // limit by at most one call's worst case — never by N concurrent calls.
      if (s.monthToDateUsd + (held?.total ?? 0) >= s.monthlyLimitUsd) throw new BudgetExceededError();
      const [row] = await tx
        .insert(budgetReservations)
        .values({
          teamId,
          amountUsd,
          expiresAt: sql`now() + make_interval(secs => ${RESERVATION_TTL_SECONDS})`,
        })
        .returning({ id: budgetReservations.id });
      return row!.id;
    });
  }

  async release(reservationId: string): Promise<void> {
    await this.db.delete(budgetReservations).where(eq(budgetReservations.id, reservationId));
  }

  async purgeExpired(): Promise<number> {
    const rows = await this.db
      .delete(budgetReservations)
      .where(sql`${budgetReservations.expiresAt} <= now()`)
      .returning({ id: budgetReservations.id });
    return rows.length;
  }

  private async statusIn(db: Db | Tx, teamId: string): Promise<BudgetStatus> {
    const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) throw notFound('Team');
    const [spent] = await db
      .select({ total: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)` })
      .from(llmCalls)
      .where(and(eq(llmCalls.teamId, teamId), gte(llmCalls.startedAt, sql`date_trunc('month', now())`)));
    const mtd = spent?.total ?? 0;
    const limit = team.monthlyBudgetUsd;
    const state: BudgetState =
      mtd >= limit ? 'hard' : mtd >= (limit * team.softLimitPct) / 100 ? 'soft' : 'ok';
    return {
      state,
      monthlyLimitUsd: limit,
      softLimitPct: team.softLimitPct,
      monthToDateUsd: Math.round(mtd * 1e6) / 1e6,
    };
  }
}
