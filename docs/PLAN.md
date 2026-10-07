# AgentOps for a CRM — Project Plan

A small but complete AI platform built around a CRM. The point is not a chatbot: it is the
**foundation** a company would use to build and scale AI agents — a gateway that routes work to
models, runs agents defined as data, gates risky tool calls behind human approval, versions prompts,
tracks every token and dollar per team, traces every run, and is evaluated in CI before it ships.

Everything is TypeScript. The CRM stands in for an existing business system (the job posting's
Laravel CRM); the gateway talks to it only over HTTP, so the CRM could be swapped for Laravel,
Rails or anything else without touching the AI side.

---

## 1. Goals and non-goals

**Goals** (each maps to a line in the job posting)

| Posting asks for | Where this project shows it |
|---|---|
| AI/LLM and agentic systems | Agent runtime with a tool loop, multi-step workflow engine |
| Agent architecture and orchestration | Agents-as-config, workflow state machine that pauses and resumes |
| Backend / system architecture | Two services with a clear contract, Postgres, idempotency, budget locking |
| LLM APIs, tool calling, workflows | Anthropic, OpenAI and Gemini adapters behind one interface; tool calling with schemas |
| Model and task routing | Policy table: task type → ordered model chain, fallback, circuit breaker, budget downgrade |
| Prompt and agent management | Versioned prompt registry, weighted A/B deployments, one-call rollback |
| Usage, cost tracking, observability | Per-call ledger (tokens, cost, latency, model, prompt version, team), budgets, OpenTelemetry traces, dashboard |
| DevOps, CI/CD, production | Docker, Compose, GitHub Actions (lint, typecheck, tests, evals, image build), Railway deploy with staging → production |

**Non-goals:** polished CRM UI, multi-tenant billing, SSO, RAG/vector search (stretch only),
streaming responses to the browser (stretch).

---

## 2. Architecture

```
 ┌──────────────┐  /api   ┌─────────────────────┐   HTTP + team API key   ┌──────────────────────────────┐
 │  Web (React) │ ──────▶ │  CRM API (NestJS)   │ ──────────────────────▶ │  AI Gateway (Fastify)        │
 │  CRM + Ops   │         │  contacts, deals,   │                         │  router · agents · prompts   │
 │  dashboard   │         │  notes, auth,       │ ◀────────────────────── │  tool loop · approvals       │
 └──────────────┘         │  /ai/* proxy,       │   POST /tools/:name     │  workflows · budgets · ledger│
                          │  /tools/* (agent    │   (service token)       └──────┬───────────┬───────────┘
                          │   tool API)         │                                │           │
                          └─────────┬───────────┘                                │           │ OTLP
                                    │                          Anthropic / OpenAI / Gemini   ▼
                              Postgres (crm db)                  (or deterministic mock)   Jaeger
                                                                                 │
                                                                        Postgres (gateway db)
```

- **Web** never talks to the gateway directly. The CRM backend proxies `/ai/*` with the team's API
  key, the same way an existing Laravel app would call an AI service.
- **Gateway → CRM** goes through a small tool API secured with a service token. Tool argument and
  result schemas live in `packages/contracts` and are shared by both sides.
- **Two databases** (`agentops_crm`, `agentops_gateway`): each service owns its data.
- **Trace context** (`traceparent`) propagates gateway → CRM, so one trace shows the LLM calls and
  the CRM work they triggered.

### Repository layout

```
apps/
  gateway/     Fastify AI gateway (the core)
    src/providers/    anthropic, openai, gemini, mock adapters + normalized types
    src/routing/      policy resolution, circuit breaker, fallback
    src/budget/       reservations + month-to-date spend
    src/prompts/      registry, template rendering, A/B selection
    src/agents/       agent runtime (tool loop, approvals, sanitisation)
    src/tools/        tool registry + CRM HTTP executor
    src/workflows/    workflow definitions + engine
    src/usage/        ledger + summary queries
    src/http/         routes, auth, errors
    evals/            golden cases + runner
  crm/         NestJS mini-CRM (contacts, deals, notes, auth, /tools, /ai proxy)
  web/         React + Vite: CRM screens, approvals inbox, ops dashboard, prompt registry
packages/
  contracts/   zod schemas shared by all three apps (tool I/O, gateway DTOs)
docs/          this plan, architecture notes, ADRs, demo script
infra/         docker-compose, nginx template
.github/       CI, deploy, nightly live evals
```

### Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24, TypeScript 6, pnpm workspaces | One language end to end |
| Gateway HTTP | Fastify 5 | Fast, schema-friendly, small |
| CRM | NestJS 12 (ESM) | Module/DI structure similar to Laravel; closest TS analogue for a "big business app" |
| DB | Postgres 17 + Drizzle ORM + SQL migrations | Typed queries, plain-SQL migrations reviewed in PRs |
| Validation | zod 4 (also generates tool JSON Schemas) | One schema → runtime validation + LLM tool definition |
| LLM SDKs | `@anthropic-ai/sdk`, `openai`, `@google/genai` | Official SDKs behind our own interface |
| Tracing | OpenTelemetry SDK → OTLP → Jaeger | Vendor-neutral; Langfuse/Honeycomb/Datadog accept OTLP too |
| Web | React 19, Vite, TanStack Query, Tailwind, Recharts | Fast to build, easy to read |
| Tests | Vitest (+ supertest for the CRM) | Same runner everywhere |
| Lint/format | Biome | One fast tool |
| Deploy | Docker images, Railway (staging + production) | Cheap, simple, supports private networking |

---

## 3. Gateway design (the core)

### 3.1 Provider abstraction
One normalized interface (`ChatRequest` → `ChatResponse`) with messages, tool definitions, tool calls,
usage and a stop reason (`end | tool_use | max_tokens | refusal`). Each adapter maps to its SDK:

- **Anthropic** — Messages API; tool results grouped into one user turn; assistant content replayed
  verbatim (keeps thinking blocks valid) when the same model continues; `effort` from model params;
  server-side refusal fallback enabled for Sonnet 5.5 / Opus 5.5.
- **OpenAI** — Chat Completions function calling.
- **Gemini** — `generateContent` with function declarations.
- **Mock** — deterministic, rule-based simulator so the whole system (and CI) runs with no API keys.
  Priced like real models so dashboards show realistic numbers. Clearly labelled as `mock:*`.

SDK-level retries are disabled; the gateway owns retry/fallback policy. Provider errors are
normalized into `ProviderError { retryable, status, code }` and never leak to clients.

### 3.2 Model and task routing
`routing_policies` table: `task_type → [primary, fallback…]` plus a `budget_model`.

Resolution for a call:
1. Start from the policy chain for the agent's task type (`chat`, `summarize`, `draft_email`, `classify`).
2. If the team is over its **soft** budget limit, put the policy's cheaper `budget_model` first
   (reason `budget_downgrade`).
3. Drop models whose provider has no credentials, that are disabled, or whose circuit is open.
4. If `LLM_MOCK_FALLBACK=true` (dev/CI), append the matching mock model as last resort.
5. Try in order: one quick retry on the same model for 429/5xx/timeouts, then fall back to the next.

Every attempt is a ledger row with its `routing_reason` (`primary`, `fallback`, `budget_downgrade`,
`mock_fallback`), so "why did this run use Haiku?" is answerable from data.

**Circuit breaker:** in-memory per model; 3 consecutive failures open it for 30s.
**Fault injection** (`x-fault-model` header, only when `ALLOW_FAULT_INJECTION=true`) forces a
retryable failure on a given model to demo fallback.

### 3.3 Agents as configuration
`agents` table: `slug, name, description, task_type, prompt_name, tools[], max_steps, enabled`.
Changing an agent's tools or prompt is a data change, not a deploy.

Seeded agents:
| Agent | Task type | Tools | Purpose |
|---|---|---|---|
| `crm-assistant` | chat | search_contacts, get_contact, list_deals, add_note✱, move_deal_stage✱ | Ask-AI on a contact |
| `lead-summarizer` | summarize | get_contact | Short lead brief |
| `email-drafter` | draft_email | — | Follow-up email draft |

✱ write tool → requires human approval.

### 3.4 Prompt registry
`prompts` + `prompt_versions` (immutable, numbered) + `prompt_deployments` (weights per version).
- Templates use `{{variable}}` placeholders; missing variables fail fast.
- **A/B:** weights like `[{v1: 50}, {v2: 50}]`. Assignment is a stable hash of the run's
  idempotency key or id, so retries get the same version.
- **Rollback:** set weights to `[{v1: 100}]` — one API call, recorded in `updated_at`/`updated_by`.
- Every run and ledger row stores `prompt_version_id`, so cost/latency/eval results can be compared
  per version.

### 3.5 Agent runtime and tool approvals
Manual tool loop (not an SDK runner) because runs must **pause across HTTP requests** for approval
and work across providers:

```
loop up to max_steps:
  call router(task_type, messages, tools)  → ledger row(s)
  if text only            → sanitise, complete
  for each tool call:
     validate args with zod (invalid → error tool_result back to model)
     read tool            → execute against CRM, append result
     write tool           → create approval, run status = awaiting_approval, STOP
resume(approval):
  approved → execute tool, append result, continue loop
  rejected → append "rejected by <user>: <note>" as tool result, continue loop
```
- Conversation state is persisted (`run_messages`), so a resume after a restart works.
- Output sanitisation strips leaked tool-call markup and internal tags.
- Errors returned to clients are generic codes; details stay in logs and the trace.

### 3.6 Workflows
A small engine runs workflows defined as ordered steps (`agent`, `approval`, `tool`) with a shared
context. State lives in `workflow_runs`, so it can stop at an approval and resume later.

`lead-follow-up`:
1. `lead-summarizer` → `ctx.summary`
2. `email-drafter` (input: summary) → `ctx.draft`
3. **approval**: "Send follow-up email?" (shows draft)
4. tool `add_note` (logs the approved email on the contact)
5. tool `move_deal_stage` → `qualified` if the open deal is still a `lead`

### 3.7 Usage, cost and budgets
- `llm_calls` ledger: team, run, agent, task type, provider, model, prompt version, input/output
  tokens, cost (numeric, computed from the `models` price table), latency, status, error code,
  routing reason, attempt number, trace id.
- **No double charging:** `POST /v1/runs` accepts an `Idempotency-Key`; a replay returns the stored
  run instead of re-running it. Ledger rows are unique on `(run_id, step, attempt)`.
- **Budgets:** `teams.monthly_budget_usd` with a soft limit (default 80%). Before each call the
  gateway takes a per-team advisory lock, sums month-to-date spend + open reservations, and — if that
  is under the limit — inserts a reservation for the worst-case cost of the call. After the call the
  reservation is replaced by the real ledger row in one transaction. Concurrent requests cannot jointly
  overspend: total spend can exceed the limit by at most one call's worst case (ADR 0004).
  Over soft limit → downgrade model. Over hard limit → `402 budget_exceeded`.
- Per-API-key rate limiting.

### 3.8 Observability
- OpenTelemetry spans: `agent.run`, `llm.call` (GenAI semantic-convention attributes: system, model,
  input/output tokens, cost), `tool.call`, `workflow.step`. HTTP instrumentation propagates context
  to the CRM.
- Run detail endpoint returns a timeline built from the ledger + tool calls, so the dashboard shows a
  waterfall even where Jaeger isn't deployed. Runs store `trace_id` for a Jaeger deep link.
- `GET /v1/usage/summary`: cost per agent per day, calls, p95 latency per agent and model, error rate,
  budget state, cost per prompt version.

### 3.9 Security
- Team API keys stored as SHA-256 hashes, shown once at creation; scopes `runs`, `admin`.
- Gateway → CRM tool API uses a separate service token; tools only expose what agents need
  (no delete, no company/job creation).
- Write tools always require approval; approvals record who decided.
- Fault injection and mock fallback are off by default in production config.

---

## 4. Gateway HTTP API (v1)

Auth: `Authorization: Bearer <api key>`. Admin routes need the `admin` scope.

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/me` | Team and scopes behind the calling key |
| POST | `/v1/runs` | Start an agent run `{agent, input, context?}`; header `Idempotency-Key` |
| GET | `/v1/runs` | List team runs (`agent`, `status`, `limit`) |
| GET | `/v1/runs/:id` | Run with messages, LLM calls, tool calls, timeline |
| GET | `/v1/approvals` | Pending (or `status=`) approvals for the team |
| POST | `/v1/approvals/:id` | `{decision: approve|reject, decidedBy, note?}` → resumes run/workflow |
| POST | `/v1/workflows/:name/runs` | Start a workflow `{input}` |
| GET | `/v1/workflows/runs/:id` | Workflow run state |
| POST | `/v1/complete` | Routed single completion `{taskType, system?, prompt}` (plain gateway use) |
| GET | `/v1/usage/summary` | Dashboard metrics (`days`) |
| GET/POST/PUT | `/v1/admin/agents[/:slug]` | Agent config |
| GET | `/v1/admin/prompts[/:name]` | Prompts with versions and deployment |
| POST | `/v1/admin/prompts/:name/versions` | New immutable version |
| PUT | `/v1/admin/prompts/:name/deployment` | Weights (A/B, rollback) |
| GET/PUT | `/v1/admin/routing[/:taskType]` | Routing policies |
| GET | `/v1/admin/models` | Model catalogue + prices + provider availability |
| GET/POST | `/v1/admin/teams`, PUT `/v1/admin/teams/:id/budget`, POST `/v1/admin/teams/:id/keys` | Teams, budgets, keys |
| GET | `/health`, `/ready` | Liveness / DB readiness |

All request/response shapes are zod schemas in `packages/contracts/src/gateway.ts`.

## 5. CRM API

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | JWT login (seeded `admin@acme.test` / `rep@acme.test`, password `password123`) |
| GET | `/me` | Current user |
| GET/POST | `/contacts`, GET/PATCH `/contacts/:id` | Contacts (search `q`) with deals + notes |
| GET | `/deals`, PATCH `/deals/:id` | Deals and stage changes |
| POST | `/contacts/:id/notes` | Add a note |
| POST | `/tools/:name` | Agent tool API (service token): `search_contacts`, `get_contact`, `list_deals`, `add_note`, `move_deal_stage` |
| * | `/ai/*` | Proxy to gateway: ask, follow-up workflow, runs, approvals, usage; admin-only: prompts, agents, routing, budget |

## 6. Data model (gateway)

`teams`, `api_keys`, `models`, `routing_policies`, `prompts`, `prompt_versions`,
`prompt_deployments`, `agents`, `runs`, `run_messages`, `tool_calls`, `approvals`, `workflow_runs`,
`llm_calls`, `budget_reservations`. CRM: `users`, `contacts`, `deals`, `notes`.

---

## 7. Quality: tests and evals

- **Unit/integration (Vitest):** router (fallback, breaker, downgrade, provider filtering), budget
  (reservation, soft/hard, concurrency), prompt A/B determinism and rollback, agent loop
  (read tools, approval pause/resume, rejection, invalid args, max steps), workflow pause/resume,
  idempotent run replay, adapters' message mapping, CRM tool endpoints and auth.
- **Evals (`apps/gateway/evals/cases.json`):** 18 golden cases run through the real gateway stack against a
  fixture CRM. Each case checks some of: tools called / not called, approval required, output
  contains/excludes, routed model tier, prompt version, cost ceiling. CI fails below a 90% pass rate
  or on any `critical` case. CI uses the mock provider (deterministic, free); a nightly/manual
  workflow runs the same suite live when API keys are configured.

## 8. DevOps

- Multi-stage Dockerfiles per app; web is static files behind nginx that proxies `/api` to the CRM.
- `infra/docker-compose.yml`: postgres, jaeger, gateway, crm, web — `docker compose up` runs it all.
- **CI** (every push/PR): install → Biome → typecheck → tests (Postgres service) → evals → build
  images. Eval report posted to the job summary.
- **Deploy** (`main` → staging automatically; production via manual dispatch with GitHub environment
  approval): Railway CLI per service. Migrations run on container start before the server listens.
  Skips cleanly if `RAILWAY_TOKEN` isn't configured. One Dockerfile with a stage per app, selected by
  `--target` or the `APP` build arg (see `docs/deploy.md`).
- **Live evals** (nightly + manual): runs evals against real providers when keys exist.

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Workspace, contracts, plan | `pnpm install`, contracts build |
| M1 | CRM | Seeded CRM, auth, tool API, tests green |
| M2 | Gateway core | Providers, routing, budgets, ledger, prompts, agents, approvals, tests green |
| M3 | Workflows + CRM integration | Ask-AI and follow-up workflow work end to end |
| M4 | Observability + dashboard | Traces in Jaeger, dashboard shows cost/latency/errors |
| M5 | Evals + CI/CD | CI green on GitHub, evals gate merges, deploy workflow ready |
| M6 | Docs | README, ADRs, demo script |

## 10. Demo script (2 minutes)

1. Log in as `admin@acme.test`, open a contact → **Ask AI**: "Summarise this lead and add a note
   that we should call next week." → summary appears; the note waits in **Approvals**.
2. Approve it → run resumes, note appears on the contact.
3. **Run follow-up workflow** → summary → draft → approve → note logged, deal moved to qualified.
4. **Ops dashboard**: cost per agent per day, p95 latency, error rate, prompt version split.
5. Open the run → timeline of LLM and tool calls; "Open trace" → Jaeger.
6. Lower the team budget → next run shows `budget_downgrade` to the cheaper model; lower further
   → `402 budget_exceeded`.
7. Prompts page → roll `crm-assistant` back from v2 to v1.

## 11. Interview talking points (why, not just what)

- Why a manual tool loop instead of an SDK runner (approval pauses across requests, multi-provider).
- How retries avoid double charging (idempotency keys, unique ledger attempts).
- How concurrent requests are stopped from overspending (advisory lock + reservations).
- Why routing is data (change policy without deploys; reasons recorded per call).
- Why the CRM is behind an HTTP tool API (least privilege; works with any backend, including Laravel).
- What evals can and can't tell you with a mock provider, and why the live suite exists.
