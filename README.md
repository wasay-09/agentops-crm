<div align="center">

# AgentOps CRM

**An AI gateway and agent platform built around a CRM, in TypeScript.**

Agents are defined as data and routed across Claude, GPT and Gemini. Every write waits for a human approval,
prompts are versioned and A/B tested, and every token and dollar is tracked per team. Runs are traced, and the
system is evaluated in CI before it ships.

[![CI](https://github.com/wasay-09/agentops-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/wasay-09/agentops-crm/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-24-5fa04e?logo=nodedotjs&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-17-4169e1?logo=postgresql&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-traces-f5a800?logo=opentelemetry&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-lightgrey.svg)](LICENSE)

<img src="docs/screenshots/contact-ask-ai.png" alt="Ask AI on a CRM contact: the agent proposes a note, which waits for human approval" width="900">

</div>

---

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start](#quick-start)
- [A two-minute tour](#a-two-minute-tour)
- [How it works](#how-it-works)
- [API](#api)
- [Testing and evals](#testing-and-evals)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Project layout](#project-layout)
- [Limits and roadmap](#limits-and-roadmap)

## Why this exists

Most "AI features" are a chatbot wired straight to one model. That's fine until a company wants many agents
across the business, and suddenly needs answers to questions like these:

- Which model should this task use, and what happens when that provider is down?
- Who approved the AI changing a customer record?
- What did the sales team's agents cost last week, and which prompt version was cheaper?
- Did yesterday's prompt change make answers worse?

This project is the **foundation** that answers those questions. It sits next to an existing business system
(here a small CRM) and gives it a gateway, agents, approvals, cost controls, observability and evals. The CRM talks
to the gateway only over HTTP, so the same platform works next to Laravel, Rails, Django or anything else.

## Features

| | |
|---|---|
| 🔀 **Model and task routing** | A policy maps each task type to an ordered chain of models. Transient errors get one quick retry, then fall back to the next model. A per-model circuit breaker skips failing providers, and teams over their soft budget are routed to a cheaper model. |
| 🧩 **Provider abstraction** | One normalized chat interface with adapters for the Anthropic, OpenAI and Gemini SDKs. A deterministic mock provider lets the whole stack (and CI) run without API keys. |
| 🤖 **Agents as configuration** | Each agent is a database row: prompt, task type, allowed tools, max steps. Behaviour changes without a deploy. |
| ✋ **Human-in-the-loop tools** | Read tools run immediately. Write tools (`add_note`, `move_deal_stage`) pause the run until a person approves; the run then resumes, durably, on any instance. |
| 🔁 **Workflows** | Multi-step flows mix deterministic steps with agent steps and approval gates, with state persisted between steps. |
| 📝 **Prompt registry** | Immutable prompt versions, weighted A/B deployments that are sticky per request, and one-click rollback. Every call records its prompt version. |
| 💸 **Usage, cost and budgets** | A ledger row per model attempt: tokens, cost, latency, model, prompt version, routing reason and team. Monthly team budgets are concurrency-safe, and idempotency keys prevent double charging. |
| 🔭 **Observability** | OpenTelemetry spans for runs, model calls (GenAI attributes), tools and workflow steps; trace context flows from the gateway into the CRM. The ops dashboard shows cost per agent per day, p95 latency, error rates and per-version cost. |
| ✅ **Evals in CI** | 18 golden cases run through the full stack on every push and gate the merge. The same cases run nightly against real models. |
| 🚢 **DevOps** | One multi-stage Dockerfile builds three images, plus a Compose stack with Jaeger. GitHub Actions run lint → typecheck → tests → evals → images; deploys go to Railway staging, with production on manual approval. |

## Architecture

```mermaid
flowchart LR
  Web["<b>Web</b> · React<br/>CRM screens + ops console"] -- "/api" --> CRM["<b>CRM API</b> · NestJS<br/>contacts · deals · notes · auth"]
  CRM -- "team API key<br/>/v1/runs · /v1/workflows · /v1/approvals" --> GW
  GW -- "service token<br/>POST /tools/:name" --> CRM

  subgraph GW["<b>AI Gateway</b> · Fastify"]
    direction TB
    WF[Workflow engine] --> AR[Agent runtime]
    AR --> PR[Prompt registry]
    AR --> RT[Router + circuit breaker]
    RT --> BG[Budgets]
    RT --> LG[Usage ledger]
    RT --> PV[Provider adapters]
  end

  PV --> A[Anthropic] & O[OpenAI] & G[Gemini] & M[Mock]
  GW --> GDB[(gateway db)]
  CRM --> CDB[(crm db)]
  GW -. OTLP .-> J[Jaeger]
  CRM -. OTLP .-> J
```

- **The web app only talks to the CRM.** The CRM proxies `/ai/*` to the gateway with its team API key, the way an
  existing product would adopt an internal AI service.
- **The gateway reaches back through five typed tools.** Their zod schemas live in [`packages/contracts`](packages/contracts)
  and are shared by both services; the JSON Schemas sent to the LLM are generated from the same definitions.
- **Each service owns its own database.**

Every major decision is written up as a short ADR in [`docs/adr`](docs/adr), and the original plan is in
[`docs/PLAN.md`](docs/PLAN.md).

## Quick start

### Option 1: local Node (fastest)

You need Node 24 (22.12+ works), pnpm 10, and Postgres 15+ on `localhost:5432` that your OS user can log in to without
a password (the default for Homebrew and Postgres.app).

```bash
git clone https://github.com/wasay-09/agentops-crm.git && cd agentops-crm
pnpm install
pnpm db:setup                                    # creates both databases, migrates, seeds demo data
cp apps/gateway/.env.example apps/gateway/.env
pnpm dev                                         # gateway :4000 · CRM :3000 · web :5173
```

### Option 2: Docker

```bash
docker compose -f infra/docker-compose.yml up --build
# web http://localhost:8080 · gateway http://localhost:4000 · Jaeger http://localhost:16686
```

### Sign in

| User | Password | Can see |
|---|---|---|
| `admin@acme.test` | `password123` | everything, including prompts, agents, routing and budgets |
| `rep@acme.test` | `password123` | CRM, approvals, runs and the dashboard; no admin pages |

> **No API keys needed.** Without keys, each model in a routing chain is simulated as `mock:<model>` at that
> model's real price, so routing, fallbacks, budgets and dashboards all behave realistically. To use real models,
> add `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and/or `GEMINI_API_KEY` to `apps/gateway/.env`; the router uses
> whichever providers have keys.

## A two-minute tour

**1. Ask AI on a contact.** Open *Contacts → Maya Chen* and ask: *"Summarise this lead and add a note that we should
call next week."* The agent reads the contact through a tool, then proposes the note, which waits for approval
(screenshot at the top). Approve it, and the run resumes and the note appears, authored
*"AI agent (approved by admin@acme.test)"*.

**2. Run the follow-up workflow.** The workflow loads the contact, writes a lead brief, drafts an email and stops
for approval. After you approve, it logs the email and moves the deal to *qualified*.

<p align="center"><img src="docs/screenshots/workflow.png" alt="Follow-up workflow waiting for approval of the email draft" width="620"></p>

**3. Check the ops dashboard:** spend, calls, p95 latency, error rate, cost per agent per day, the budget meter, why
each model was chosen, and per-model and per-prompt-version tables. Dark mode is supported.

<p align="center"><img src="docs/screenshots/dashboard.png" alt="Ops dashboard" width="900"></p>

**4. Open a run.** Each run has a timeline of model and tool calls with tokens, cost and routing reason. In this one the
primary model was forced to fail, so you can see the retry, the fallback to the next model, and on the next step the
circuit breaker cutting the retry short. With tracing on, *Open trace* jumps to Jaeger.

<p align="center"><img src="docs/screenshots/run-detail.png" alt="Run detail timeline showing a fallback" width="900"></p>

**5. Manage prompts.** `crm-assistant` runs v1 and v2 at 50/50. You can create a version, change the split, or roll
back in one click.

<p align="center"><img src="docs/screenshots/prompts.png" alt="Prompt registry with an A/B deployment" width="900"></p>

**6. Change behaviour without a deploy.** Edit agents, routing chains and the team budget. Lower the budget and new
runs show `budget_downgrade` on the cheaper model; lower it further and the gateway answers `402 budget_exceeded`.

<p align="center"><img src="docs/screenshots/agents-routing.png" alt="Agents, routing policies and team budget" width="900"></p>

<details>
<summary>More screenshots: approvals inbox, dark mode, mobile</summary>

<p><img src="docs/screenshots/approvals.png" alt="Approvals inbox" width="900"></p>
<p><img src="docs/screenshots/dashboard-dark.png" alt="Dashboard in dark mode" width="900"></p>
<p><img src="docs/screenshots/mobile-contact.png" alt="Contact page on mobile" width="320"></p>

</details>

## How it works

### The life of a run that needs approval

```mermaid
sequenceDiagram
  autonumber
  actor Rep
  participant CRM
  participant GW as Gateway
  participant LLM as Model (routed)
  Rep->>CRM: Ask AI: "add a note that we should call next week"
  CRM->>GW: POST /v1/runs {agent, input, context} + Idempotency-Key
  GW->>GW: pick prompt version (sticky A/B), check budget, plan route
  GW->>LLM: messages + tool schemas
  LLM-->>GW: tool_use get_contact
  GW->>CRM: POST /tools/get_contact (read: runs now)
  GW->>LLM: tool result
  LLM-->>GW: tool_use add_note
  GW->>GW: write tool → create approval, run = awaiting_approval
  GW-->>CRM: run (awaiting_approval)
  Rep->>CRM: Approve
  CRM->>GW: POST /v1/approvals/:id {approve, decidedBy}
  GW->>CRM: POST /tools/add_note (actor = approver)
  GW->>LLM: tool result
  LLM-->>GW: final answer
  GW-->>CRM: run (completed) + ledger rows, trace id
```

### The key design decisions

| Topic | Decision | ADR |
|---|---|---|
| Service boundary | The gateway is its own service; the CRM is reached only through a narrow, typed tool API. Agents can't do anything the tool API doesn't expose. | [0001](docs/adr/0001-gateway-as-a-separate-service.md) |
| Routing | Policies are data. Each attempt records why its model was chosen (`primary`, `fallback`, `budget_downgrade`, `mock_fallback`). SDK retries are off so there's one retry policy. | [0002](docs/adr/0002-routing-policies-as-data.md) |
| Agent loop | A hand-written loop, because runs must pause across HTTP requests and work across providers. A decision is recorded exactly once; only one request can resume a run. | [0003](docs/adr/0003-manual-agent-loop-with-approvals.md) |
| Budgets | Each call reserves its worst-case cost under a per-team Postgres advisory lock, and the reservation is swapped for the real cost afterwards. Overspend is capped at one call, whatever the concurrency. | [0004](docs/adr/0004-budgets-with-reservations.md) |
| Billing safety | Idempotency keys on run creation; ledger rows unique per `(run, step, attempt)`; cost stored at write time. | [0005](docs/adr/0005-usage-ledger-and-idempotency.md) |
| Prompts | Immutable versions, weighted sticky A/B, an allow-list of template variables, and missing variables fail fast. | [0006](docs/adr/0006-prompt-registry.md) |
| Testing AI | A deterministic mock gates the platform in CI; live evals measure model quality nightly. | [0007](docs/adr/0007-mock-provider-and-evals.md) |

Other safeguards:

- Tool arguments are validated against the shared schema before anything runs. Invalid arguments go back to the
  model as an error so it can correct itself.
- Model output is cleaned of leaked tool-call markup.
- Provider errors never reach clients; they get a stable error code and a request id.
- API keys are stored as SHA-256 hashes. Each key is rate-limited.
- The gateway refuses to start in production with the repo's dev secrets.

## API

All gateway endpoints take `Authorization: Bearer <api key>`. Request and response shapes are zod schemas in
[`packages/contracts/src/gateway.ts`](packages/contracts/src/gateway.ts).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/runs` | Start an agent run `{agent, input, context?, actor?}`; optional `Idempotency-Key` header |
| `GET` | `/v1/runs`, `/v1/runs/:id` | List runs, or get one with model calls, tool calls, approvals and timeline |
| `GET` | `/v1/approvals?status=pending` | Approvals for the team |
| `POST` | `/v1/approvals/:id` | `{decision: approve \| reject, decidedBy, note?}`; resumes the run or workflow |
| `POST` | `/v1/workflows/:name/runs` | Start a workflow, e.g. `lead-follow-up` with `{input: {contactId}}` |
| `GET` | `/v1/workflows/runs/:id` | Workflow state |
| `POST` | `/v1/complete` | A single routed completion `{taskType, prompt, system?}`, with no agent |
| `GET` | `/v1/usage/summary?days=7` | Dashboard metrics |
| `GET` | `/v1/me` | Team and scopes for the calling key |
| `*` | `/v1/admin/*` | Agents, prompts (versions and deployment), routing, models, teams, budgets, API keys; needs the `admin` scope |

```bash
KEY="Authorization: Bearer ak_dev_sales_00000000000000000000"   # dev key from the seed
JSON="content-type: application/json"

# Start a run that proposes a write
curl -s localhost:4000/v1/runs -H "$KEY" -H "$JSON" -H 'Idempotency-Key: demo-0001' \
  -d '{"agent":"crm-assistant","input":"Add a note that we should call next week","context":{"contactId":1}}'

# Approve it (resumes the run)
curl -s localhost:4000/v1/approvals -H "$KEY"
curl -s localhost:4000/v1/approvals/<id> -H "$KEY" -H "$JSON" -d '{"decision":"approve","decidedBy":"you@acme.test"}'

# Force the primary model to fail and watch the fallback (needs ALLOW_FAULT_INJECTION=true; dev only)
curl -s localhost:4000/v1/complete -H "$KEY" -H "$JSON" -H 'x-fault-model: mock:claude-sonnet-5-5' \
  -d '{"taskType":"chat","prompt":"hello"}'

curl -s 'localhost:4000/v1/usage/summary?days=7' -H "$KEY"
```

## Testing and evals

```bash
pnpm lint          # Biome
pnpm typecheck     # tsc across all packages
pnpm test          # Vitest: gateway 55 · CRM 30 · web 20 (gateway and CRM tests use a real Postgres)
pnpm eval          # 18 golden cases, mock provider
EVAL_MODE=live pnpm eval   # the same cases against real providers (needs keys)
```

**Tests** cover:

- **Routing:** fallback, circuit breaker, budget downgrade, provider availability.
- **Budgets:** concurrent reservations; 20 parallel calls against a $1 budget, of which exactly 4 are granted.
- **Prompts:** A/B stickiness and distribution, rollback.
- **The agent loop:** approve, reject, double-decide, invalid arguments, unknown tools, max steps, refusals,
  mid-run fallback, idempotent replay.
- **Also:** workflows, the message mapping of every adapter, usage aggregation, auth and team scoping.

**Evals** run real requests through the HTTP stack against an in-memory CRM, and check:

- which tools were called and which approvals were requested;
- CRM side effects;
- output content, prompt version, routing reason, model tier and cost ceilings.

Cases include prompt injection hidden in a CRM note, a CRM outage, a missing contact, a provider failure and an
exhausted budget. CI fails below a 90% pass rate or on any critical case, and posts the report to the job summary:

```
✔ summarize-lead               $0.004050   mock:claude-sonnet-5-5
✔ write-needs-approval         $0.003878   mock:claude-sonnet-5-5
✔ prompt-injection-in-notes    $0.004072   mock:claude-sonnet-5-5
✔ provider-fallback            $0.002747   mock:gpt-5
✔ budget-downgrade             $0.001945   mock:claude-haiku-4-5
✔ workflow-follow-up           $0.001967   mock:claude-haiku-4-5, mock:claude-sonnet-5-5
…
18/18 passed (100.0%), critical failures: 0
```

> **What mock-mode evals prove, and what they don't.** They gate the *platform* deterministically and for free:
> routing, approvals, budgets, workflows and error handling. They say nothing about model quality. That's what the
> nightly live run ([`evals-live.yml`](.github/workflows/evals-live.yml)) is for.

## Configuration

<details>
<summary><b>Gateway</b> (<code>apps/gateway/.env</code>)</summary>

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/agentops_gateway` | |
| `PORT` | `4000` | |
| `CRM_TOOL_URL` / `CRM_TOOL_TOKEN` | `http://localhost:3000` / `dev-tool-token` | Where tools are executed |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | empty | Providers with keys are used; the others are skipped |
| `LLM_MOCK_FALLBACK` | `true` | Simulate unavailable models (dev/CI). Set `false` in real production |
| `MOCK_LATENCY_MS` | `0` | Simulated latency for the mock |
| `SEED_SALES_API_KEY`, `SEED_ADMIN_API_KEY` | dev keys | Seeded team keys; use real secrets when deployed |
| `RUN_MIGRATIONS`, `SEED_ON_START` | `false` | `true` in containers |
| `ALLOW_FAULT_INJECTION` | `false` | Enables the `x-fault-model` header (demos/evals only) |
| `RATE_LIMIT_PER_MINUTE` | `120` | Per API key |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | e.g. `http://localhost:4318` for Jaeger |

</details>

<details>
<summary><b>CRM</b> (<code>apps/crm/.env</code>)</summary>

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/agentops_crm` | |
| `PORT` | `3000` | |
| `JWT_SECRET` | dev value | Change when deployed |
| `CRM_TOOL_TOKEN` | `dev-tool-token` | Must match the gateway |
| `GATEWAY_URL`, `GATEWAY_API_KEY`, `GATEWAY_ADMIN_KEY` | local defaults | How the CRM calls the gateway |
| `CORS_ORIGIN` | `http://localhost:5173` | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | |

</details>

The web app needs only an optional `VITE_TRACE_URL_TEMPLATE` (e.g. `http://localhost:16686/trace/{traceId}`) to link
runs to Jaeger.

## Deployment

One `Dockerfile` builds all three images (`--target gateway | crm | web`, or the `APP` build arg). Containers run
database migrations on start.

```
push to main ─▶ CI: lint · typecheck · tests · evals · build images ─▶ push to GHCR
                                                                  └─▶ Deploy: Railway staging
manual dispatch ─────────────────────────────────────────────────────▶ Deploy: Railway production
```

Step-by-step Railway setup, environment variables and secrets are in [`docs/deploy.md`](docs/deploy.md). The deploy
job skips cleanly until a `RAILWAY_TOKEN` is configured.

## Project layout

```
apps/
  gateway/                 Fastify AI gateway
    src/providers/           anthropic · openai · gemini · mock adapters, normalized types
    src/routing/             router, circuit breaker, catalog cache, LlmService (retry · fallback · ledger)
    src/budget/              reservations and month-to-date spend
    src/prompts/             registry, rendering, A/B selection
    src/agents/              runtime (tool loop, approvals), run repository, output sanitising
    src/workflows/           workflow definitions and engine
    src/usage/               ledger and dashboard queries
    src/http/                routes, API-key auth, error handling
    evals/                   golden cases, runner, in-memory CRM fixture
    drizzle/                 SQL migrations
  crm/                     NestJS CRM: auth, contacts/deals/notes, /tools (agent API), /ai (gateway proxy)
  web/                     React + Vite ops console
packages/contracts/        zod schemas shared by all three apps
infra/                     docker-compose, nginx template, Railway service configs
docs/                      plan, ADRs, deploy guide, screenshots
.github/workflows/         ci · deploy · evals-live
```

**Stack:** TypeScript 6 · Node 24 · Fastify 5 · NestJS 12 · React 19 · Vite · TanStack Query · Tailwind · Recharts ·
Postgres 17 · Drizzle ORM · zod 4 · OpenTelemetry · Vitest · Biome · pnpm workspaces · Docker · GitHub Actions ·
Railway.

## Limits and roadmap

- **Per-instance state:** the circuit breaker and auth cache live in each instance's memory. Past a few replicas,
  move them to Redis.
- **Background work:** runs execute inside the HTTP request. Long runs should move to a queue (BullMQ/SQS) with
  `202 Accepted` plus polling or SSE; the persisted state model already supports this.
- **Streaming:** responses aren't streamed to the browser yet.
- **Pricing data:** the OpenAI and Gemini prices in the seed are examples. Prices are rows in the `models` table;
  check them before relying on them.
- **RAG:** retrieval over notes and documents is the natural next agent capability.

## License

[MIT](LICENSE)
