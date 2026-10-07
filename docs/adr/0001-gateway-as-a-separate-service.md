# ADR 0001 — The AI gateway is a separate service, reached over HTTP

**Status:** accepted

**Context.** The business system (here a TypeScript CRM, in the job posting a Laravel CRM) already owns
users, data and permissions. AI work needs its own concerns: provider keys, routing, budgets, prompt
versions, traces. Putting those inside the CRM couples every AI change to CRM deploys and ties the AI
foundation to one framework.

**Decision.** The gateway is its own service with its own database. The CRM calls it with a team API key
(`POST /v1/runs`, `/v1/workflows/...`), and the gateway calls back into the CRM only through a narrow tool
API (`POST /tools/:name`, service token). Tool argument/result schemas live in `packages/contracts` and are
shared by both sides.

**Consequences.**
- Any backend (Laravel, Rails, a queue worker) can use the gateway; nothing about it is CRM-specific.
- Agents get least privilege: they can only do what the tool API exposes (no deletes, no company creation).
- One extra network hop and a contract to keep in sync — mitigated by the shared zod schemas and CI tests on both sides.
- Per-team keys make usage attributable without the gateway knowing CRM users; the CRM passes `actor` for audit.
