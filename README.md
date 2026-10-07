# AgentOps CRM

An AI gateway and agent platform built around a CRM. Agents are defined as data and routed across
Claude, GPT and Gemini. Every write waits for a human approval, prompts are versioned and A/B tested, and
every token and dollar is tracked per team. Runs are traced, and the system is evaluated in CI before it ships.

The CRM stands in for an existing business system. The gateway only talks to it over HTTP, so the same
foundation would sit next to a Laravel, Rails or any other backend unchanged.

Everything is TypeScript: **Fastify** gateway, **NestJS** CRM, **React** ops console, **Postgres**,
**OpenTelemetry**, **GitHub Actions**, **Docker**, **Railway**.

![Contact page with Ask AI and a pending approval](docs/screenshots/contact-ask-ai.png)

## What it does

| Capability | How |
|---|---|
| **Provider abstraction** | One normalized chat interface; adapters for the Anthropic, OpenAI and Gemini SDKs, plus a deterministic mock so everything runs without keys |
| **Model and task routing** | Policy table: task type → ordered model chain. One retry on transient errors, then fallback; per-model circuit breaker; cheaper model when a team passes its soft budget |
| **Agents as configuration** | `agents` rows: prompt, task type, allowed tools, max steps. Change behaviour without a deploy |
| **Tool calling with approvals** | Read tools run immediately; write tools (`add_note`, `move_deal_stage`) pause the run for human approval and resume afterwards, durably |
| **Workflows** | `lead-follow-up`: load contact → brief (agent) → email draft (agent) → **approval** → log note → advance deal. Persists state between steps |
| **Prompt registry** | Immutable versions, weighted sticky A/B (e.g. 50/50), one-call rollback, version recorded on every call |
| **Usage and cost** | Ledger row per attempt: tokens, cost, latency, model, prompt version, routing reason, team. Idempotency keys prevent double charging |
| **Budgets** | Monthly per-team limits: soft limit downgrades, hard limit returns `402`. Concurrency-safe reservations (overspend capped at one call) |
| **Observability** | OpenTelemetry spans for runs, LLM calls (GenAI attributes), tools and workflow steps; trace context flows gateway → CRM; Jaeger in Compose; run timeline in the UI |
| **Ops dashboard** | Cost per agent per day, p95 latency, error rate, by model, by prompt version, routing reasons, budget meter |
| **Quality gates** | 104 unit and integration tests, plus 18 golden eval cases that gate CI (mock) and run nightly against real models (live) |
| **DevOps** | Multi-stage Docker (one image per app), Compose stack, CI → GHCR images → Railway staging → manual production |

## Architecture

```mermaid
flowchart LR
  Web["Web · React<br/>CRM + ops console"] -- "/api" --> CRM["CRM API · NestJS<br/>contacts, deals, notes, auth"]
  CRM -- "team API key<br/>/v1/runs · /v1/workflows · /v1/approvals" --> GW["AI Gateway · Fastify"]
  GW -- "service token<br/>POST /tools/:name" --> CRM
  subgraph GW_inner [" "]
    direction TB
    R[Router + breaker] --> P[Providers]
    A[Agent runtime] --> R
    WF[Workflow engine] --> A
    B[Budgets] --- R
    L[Ledger] --- R
    PR[Prompt registry] --- A
  end
  GW --- GW_inner
  P --> Anthropic & OpenAI & Gemini & Mock
  GW --> GDB[(gateway db)]
  CRM --> CDB[(crm db)]
  GW -. OTLP .-> J[Jaeger]
  CRM -. OTLP .-> J
```

- The web app only talks to the CRM. The CRM proxies `/ai/*` to the gateway with its team key, the way an
  existing app would adopt an AI service.
- The gateway reaches back into the CRM through five typed tools. Their zod schemas live in `packages/contracts`
  and are shared by both sides; the LLM tool definitions are generated from the same schemas.
- Each service owns its own database.

Design decisions are written up as ADRs in [`docs/adr`](docs/adr):
[gateway as a service](docs/adr/0001-gateway-as-a-separate-service.md) ·
[routing](docs/adr/0002-routing-policies-as-data.md) ·
[agent loop and approvals](docs/adr/0003-manual-agent-loop-with-approvals.md) ·
[budgets](docs/adr/0004-budgets-with-reservations.md) ·
[ledger and idempotency](docs/adr/0005-usage-ledger-and-idempotency.md) ·
[prompt registry](docs/adr/0006-prompt-registry.md) ·
[mock provider and evals](docs/adr/0007-mock-provider-and-evals.md).
The full plan is in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

**Requirements:** Node 24 (22.12+ works), pnpm 10, Postgres 15+ on `localhost:5432` that your OS user can log in to
without a password (Homebrew/Postgres.app default). Or use Docker (below).

```bash
pnpm install
pnpm db:setup        # creates agentops_gateway + agentops_crm, migrates, seeds
cp apps/gateway/.env.example apps/gateway/.env
pnpm dev             # gateway :4000, CRM :3000, web :5173
```

Open http://localhost:5173 and sign in as **admin@acme.test** / **password123** (or **rep@acme.test**, who can't
see admin pages).

**Real models:** put `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and/or `GEMINI_API_KEY` in `apps/gateway/.env`. The
router uses whichever providers have keys. Without keys, `mock:<model>` simulates each model at its real price, so
routing, budgets and dashboards still behave realistically.

**Docker:** `docker compose -f infra/docker-compose.yml up --build` → web on :8080, Jaeger on :16686.

## Demo (2 minutes)

1. **Contacts → Maya Chen → Ask AI:** "Summarise this lead and add a note that we should call next week."
   You get the summary, and the note waits for approval. Approve it, and the run resumes and the note appears,
   authored "AI agent (approved by admin@acme.test)".
2. **Run follow-up workflow:** brief → draft → approve the email → note logged, deal moved to *qualified*.
3. **Ops dashboard:** cost per agent per day, p95 latency, error rate, the prompt v1/v2 split.
4. **Runs → a run:** timeline of LLM and tool calls, tokens, cost, routing reason; with tracing on (Compose sets it up), *Open trace* jumps to Jaeger.
5. **Agents & routing → Budget:** lower the team budget. Runs switch to `budget_downgrade` on the cheaper
   model, then return `402 budget_exceeded`.
6. **Prompts → crm-assistant:** roll v2 back to v1 in one click.

The same flow works from the API:

```bash
KEY="Authorization: Bearer ak_dev_sales_00000000000000000000"
curl -s localhost:4000/v1/runs -H "$KEY" -H 'content-type: application/json' -H 'Idempotency-Key: demo-0001' \
  -d '{"agent":"crm-assistant","input":"Add a note that we should call next week","context":{"contactId":1}}'
curl -s localhost:4000/v1/approvals -H "$KEY"                       # the pending note
curl -s localhost:4000/v1/approvals/<id> -H "$KEY" -H 'content-type: application/json' \
  -d '{"decision":"approve","decidedBy":"you@acme.test"}'           # resumes the run
# Force the primary model to fail and watch the fallback (dev only):
curl -s localhost:4000/v1/complete -H "$KEY" -H 'content-type: application/json' \
  -H 'x-fault-model: mock:claude-sonnet-5-5' -d '{"taskType":"chat","prompt":"hello"}'
curl -s 'localhost:4000/v1/usage/summary?days=7' -H "$KEY"
```

<table>
<tr><td><img src="docs/screenshots/dashboard.png" alt="Ops dashboard"></td><td><img src="docs/screenshots/run-detail.png" alt="Run detail timeline"></td></tr>
<tr><td><img src="docs/screenshots/workflow.png" alt="Follow-up workflow"></td><td><img src="docs/screenshots/prompts.png" alt="Prompt registry"></td></tr>
</table>

## Repository

```
apps/gateway    Fastify AI gateway
  src/providers   anthropic · openai · gemini · mock adapters, normalized types
  src/routing     router, circuit breaker, catalog cache, LlmService (retry/fallback/ledger)
  src/budget      reservations + month-to-date spend
  src/prompts     registry, rendering, A/B selection
  src/agents      runtime (tool loop, approvals), run repository, output sanitising
  src/workflows   definitions + engine
  src/usage       ledger + dashboard queries
  src/http        routes, API-key auth, error handling
  evals/          golden cases, runner, in-memory CRM fixture
apps/crm        NestJS CRM: auth, contacts/deals/notes, /tools (agent API), /ai (gateway proxy)
apps/web        React ops console
packages/contracts   zod schemas shared by all three apps
infra/          docker-compose, nginx template, Railway configs
docs/           plan, ADRs, deploy guide
```

## Quality

```bash
pnpm lint && pnpm typecheck && pnpm test   # Biome, tsc, Vitest (gateway 54 · CRM 30 · web 20)
pnpm eval                                  # 18 golden cases, mock provider
EVAL_MODE=live pnpm eval                   # same cases against real providers (needs keys)
```

- Gateway tests run against a real Postgres. They cover routing (fallback, breaker, downgrade, provider
  availability), concurrent budget reservations, prompt A/B and rollback, the agent loop (approve, reject,
  double-decide, invalid arguments, unknown tools, max steps, refusals, mid-run fallback, idempotent replay),
  workflows, adapter message mapping, usage aggregation, and auth.
- Evals check behaviour end to end: tools called or not called, approvals requested, CRM side effects, output
  content, prompt version, routing reasons, model tier and cost ceilings. They include prompt injection inside a
  CRM note, a CRM outage, a missing contact, provider failure and budget exhaustion. CI fails below 90% or on any
  critical case; the report is posted to the job summary.

**What the mock-mode evals do and don't prove:** they gate the *platform* (routing, approvals, budgets, workflows,
error handling) deterministically and for free. They say nothing about model quality; that's what the nightly live
run is for.

## Deploying

See [`docs/deploy.md`](docs/deploy.md). In short: one Dockerfile builds `gateway`, `crm` and `web` images;
containers migrate on start. CI pushes images to GHCR, `main` deploys to Railway staging, and production is a manual,
approved dispatch.

## Limits and next steps

- The circuit breaker and auth cache are per instance. At more than a few replicas, move them to Redis.
- Runs execute inside the HTTP request. Long agent runs should move to a queue (BullMQ/SQS), with the API returning
  `202` and the UI polling or using SSE; the state model already supports this.
- No streaming to the browser yet.
- OpenAI/Gemini prices in the seed are examples; prices are data in the `models` table and should be checked
  before relying on them.
- RAG over notes and documents would be the next agent capability.
