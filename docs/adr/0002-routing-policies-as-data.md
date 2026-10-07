# ADR 0002 — Model routing is a data-driven policy with fallback, circuit breaking and budget downgrade

**Status:** accepted

**Context.** Different tasks need different models (summaries on a cheap model, drafting on a stronger
one), providers fail or rate-limit, and teams run out of budget. Hard-coding a model per call site makes
all three painful.

**Decision.** `routing_policies` maps a task type to an ordered chain of models plus an optional cheaper
`budget_model`. For each call the router: puts the budget model first when the team is over its soft limit;
drops models that are disabled, unconfigured or whose circuit is open; then tries them in order, with one
quick retry on the same model for transient errors (429/5xx/timeouts) before falling back. Every attempt is
a ledger row with its `routing_reason` (`primary`, `fallback`, `budget_downgrade`, `mock_fallback`).
SDK-level retries are disabled so this policy is the only retry logic.

**Consequences.**
- Policies change via the admin API without a deploy, and "why did this run use Haiku?" is answerable from data.
- The circuit breaker is per instance (in memory). That's enough to stop hammering a failing provider; a shared
  breaker (Redis) would be the next step at higher scale.
- A mid-run fallback switches providers. Conversation state is stored provider-neutrally; each adapter replays
  its own native turns (e.g. Claude thinking blocks) only when the same model continues.
