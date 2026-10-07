# ADR 0007 — A deterministic mock provider, and two tiers of evals

**Status:** accepted

**Context.** CI must be fast, free and deterministic, but an AI system's behaviour depends on real models.

**Decision.** A rule-based `MockProvider` simulates models: it follows intents in the user's message, calls the
same tools a real model would, and answers from tool results. It never acts on text found inside tool results.
When a provider has no key, the router can simulate each model in the chain as `mock:<model>` at the real model's
price (`LLM_MOCK_FALLBACK=true`, dev/CI only), so routing, fallback, budgets and dashboards all behave realistically.

The 18 golden cases in `apps/gateway/evals/cases.json` run through the real HTTP stack against an in-memory CRM:
- **CI (mock):** every push. Gates the merge — fails below 90% or on any critical case. This catches regressions in
  the platform: routing, approvals, budgets, prompt deployment, workflows, injection handling, error paths.
- **Live (real providers):** nightly and on demand, with keys from a protected environment. This is the quality
  signal for prompts and models.

**Consequences.** The mock is explicit about what it is (model ids are prefixed `mock:`); it is not evidence of
model quality and the README says so. Live evals cost money, hence the schedule.
