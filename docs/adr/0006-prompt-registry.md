# ADR 0006 — Prompt registry: immutable versions, weighted sticky A/B, one-call rollback

**Status:** accepted

**Context.** Prompts change more often than code and need the same discipline: history, review, gradual
rollout, fast rollback, and the ability to compare versions on cost and quality.

**Decision.** `prompt_versions` are immutable and numbered; editing a prompt means creating a version, which gets
0% traffic until deployed. `prompt_deployments` holds weights (e.g. v1 50 / v2 50). The version for a run is chosen
by hashing its idempotency key (or run id) into a 0–99 bucket, so retries stay on the same arm. Rollback is setting
weights to `[{version: 1, weight: 100}]`. Templates use `{{variable}}` placeholders from a fixed allow-list, and a
missing variable fails the request rather than sending a broken prompt. Every run and ledger row stores its prompt
version.

**Consequences.** The dashboard compares versions on runs, average cost and model time; evals can pin a version.
Agents reference prompts by name, so prompt changes never require agent or code changes.
