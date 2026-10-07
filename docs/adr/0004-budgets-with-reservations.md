# ADR 0004 — Team budgets: reservations under an advisory lock, with bounded overdraft

**Status:** accepted

**Context.** Checking "spent < limit" before a call is racy: twenty concurrent requests can all pass the check
and then jointly blow through the budget. Reserving each call's exact worst case is safe but refuses calls near
the limit that would actually have been cheap.

**Decision.** Before each LLM attempt the gateway takes `pg_advisory_xact_lock(hashtext(team_id))`, sums
month-to-date ledger spend plus open reservations, and — if that committed total is under the limit — inserts a
reservation for the call's worst-case cost (estimated input + max output tokens at the model's price). After the
call, the reservation is replaced by the real ledger row in one transaction. Reservations expire after five
minutes so crashed requests can't hold budget. States: under the soft limit (default 80%) `ok`; above it `soft`
(router downgrades to the budget model); at the limit `hard` (`402 budget_exceeded`).

**Consequences.**
- Overspend is bounded by **one** call's worst case, regardless of concurrency (a test runs 20 concurrent
  reservations against a $1 budget and asserts exactly 4 are granted).
- One short lock per team per call. Fine at this scale; a per-team counter in Redis would be the next step.
- Budgets are monthly and per team; per-user or per-agent limits would be extra rows in the same model.
