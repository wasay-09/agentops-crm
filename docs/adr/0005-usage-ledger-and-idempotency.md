# ADR 0005 — One ledger row per attempt, and idempotent run creation

**Status:** accepted

**Context.** Cost tracking must be trustworthy enough to bill teams. Clients retry on timeouts; a naive
gateway would re-run the agent and charge twice.

**Decision.**
- `POST /v1/runs` accepts an `Idempotency-Key` (unique per team). A repeated key returns the stored run instead of
  starting a new one; a concurrent duplicate loses on the unique index and returns the winner's run.
- `llm_calls` records every attempt — including failed ones and fallbacks — with team, run, agent, task type,
  provider, model, prompt version, tokens, cost, latency, routing reason and trace id. Rows are unique on
  `(run_id, step, attempt)`, so retried writes are no-ops.
- Cost is computed from the `models` price table at write time and stored, so later price changes don't rewrite history.
- Workflow agent steps derive their idempotency key from the workflow run and step, so re-driving a workflow never
  starts a second agent run.

**Consequences.** Dashboards (cost per agent per day, p95 latency, error rate, cost per prompt version) are
plain SQL over the ledger. Failed attempts count toward error rate even when a fallback recovered the call —
which is what an on-call engineer wants to see.
