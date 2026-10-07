import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { budgetReservations, llmCalls } from '../db/schema.js';

export type LedgerEntry = typeof llmCalls.$inferInsert;

/**
 * The usage ledger: one row per LLM attempt (successful or not). Rows are unique on
 * (run_id, step, attempt), so a retried write can't record — or bill — the same attempt twice.
 */
export class Ledger {
  constructor(private readonly db: Db) {}

  /** Write the real cost and drop the reservation that covered it, atomically. */
  async settle(entry: LedgerEntry, reservationId: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(llmCalls).values(entry).onConflictDoNothing();
      if (reservationId) await tx.delete(budgetReservations).where(eq(budgetReservations.id, reservationId));
    });
  }
}
