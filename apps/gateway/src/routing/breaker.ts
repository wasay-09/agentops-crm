/**
 * Per-model circuit breaker. After `threshold` consecutive failures the model is skipped for
 * `cooldownMs`; the first call after cooldown is a trial (half-open) — success closes it, failure re-opens it.
 * In-memory per instance: good enough to stop hammering a failing provider; not a global view.
 */
export class CircuitBreaker {
  private readonly state = new Map<string, { failures: number; openedAt: number | null }>();

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  isOpen(key: string): boolean {
    const s = this.state.get(key);
    if (!s || s.openedAt === null) return false;
    if (this.now() - s.openedAt >= this.cooldownMs) return false; // half-open: allow a trial call
    return true;
  }

  recordSuccess(key: string): void {
    this.state.delete(key);
  }

  recordFailure(key: string): void {
    const s = this.state.get(key) ?? { failures: 0, openedAt: null };
    s.failures += 1;
    if (s.failures >= this.threshold) s.openedAt = this.now();
    this.state.set(key, s);
  }

  reset(): void {
    this.state.clear();
  }
}
