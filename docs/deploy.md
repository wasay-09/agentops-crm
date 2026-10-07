# Deploying

The repo builds three images from one `Dockerfile` (`--target gateway | crm | web`, or the `APP` build arg).
Containers run migrations on start (`RUN_MIGRATIONS=true` is the image default), then listen.

## Local, everything in Docker

```bash
docker compose -f infra/docker-compose.yml up --build
# web http://localhost:8080 · gateway http://localhost:4000 · Jaeger http://localhost:16686
```
Add `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` to your shell to use real models; without them the
mock provider simulates each model.

## Railway (staging + production)

1. Create a Railway project with two environments, `staging` and `production`.
2. Add a **Postgres** plugin. Create two databases on it (`agentops_gateway`, `agentops_crm`), e.g. with
   `psql "$DATABASE_URL" -c 'create database agentops_gateway' -c 'create database agentops_crm'`.
3. Create three services from this GitHub repo: `gateway`, `crm`, `web`. For each one:
   - **Config file path:** `infra/railway/<service>.json`
   - **Variable** `APP=<service>` (selects the Dockerfile stage)
4. Service variables:

   | Service | Variables |
   |---|---|
   | gateway | `DATABASE_URL` (→ `agentops_gateway`), `CRM_TOOL_URL=http://crm.railway.internal:3000`, `CRM_TOOL_TOKEN`, `SEED_SALES_API_KEY`, `SEED_ADMIN_API_KEY`, `SEED_ON_START=true`, provider keys, `LLM_MOCK_FALLBACK` (`true` for a demo without keys, `false` in real production), `ALLOW_FAULT_INJECTION=false` in production |
   | crm | `DATABASE_URL` (→ `agentops_crm`), `JWT_SECRET`, `CRM_TOOL_TOKEN` (same as gateway), `GATEWAY_URL=http://gateway.railway.internal:4000`, `GATEWAY_API_KEY` (= `SEED_SALES_API_KEY`), `GATEWAY_ADMIN_KEY` (= `SEED_ADMIN_API_KEY`), `SEED_ON_START=true`, `CORS_ORIGIN` |
   | web | `CRM_UPSTREAM=http://crm.railway.internal:3000`, `PORT=8080`; give it a public domain |

   Generate secrets with `openssl rand -hex 24`. Only `web` needs a public domain; the gateway and CRM talk over
   Railway's private network.
5. GitHub → Settings → Environments: create `staging` and `production`, each with a `RAILWAY_TOKEN` secret (a
   Railway *project token* for that environment) and optionally a `WEB_URL` variable for the post-deploy smoke test.
   Add required reviewers to `production` if your plan supports it.

**Flow:** push to `main` → CI (lint, typecheck, tests, evals, image builds) → `Deploy` deploys to staging.
Production: Actions → Deploy → Run workflow → `production`. If `RAILWAY_TOKEN` isn't set, the deploy job skips
with a note instead of failing.

## Images on GHCR

On every push to `main`, CI also pushes `ghcr.io/<owner>/<repo>-{gateway,crm,web}:main` and `:sha-<commit>`, so
any container platform (Fly, ECS, Kubernetes) can run the same artifacts.

## Live evals

Create a GitHub environment `evals` with provider keys as secrets. `Live evals` runs nightly and on demand.
