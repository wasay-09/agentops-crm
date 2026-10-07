# syntax=docker/dockerfile:1.7
# One multi-stage build for the whole monorepo. Pick an app with --target gateway | crm | web,
# or with the APP build arg (used on Railway, which builds the last stage).
ARG APP=gateway

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# ---- install (cached on lockfile + manifests only) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/gateway/package.json apps/gateway/
COPY apps/crm/package.json apps/crm/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build everything once ----
FROM deps AS build
COPY . .
ARG VITE_TRACE_URL_TEMPLATE=""
ENV VITE_TRACE_URL_TEMPLATE=$VITE_TRACE_URL_TEMPLATE
RUN pnpm --filter @agentops/contracts build \
 && pnpm --filter @agentops/gateway build \
 && pnpm --filter @agentops/crm build \
 && pnpm --filter @agentops/web exec vite build
# Pruned production bundles (only runtime deps, workspace package copied in).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @agentops/gateway deploy --prod --legacy /out/gateway \
 && pnpm --filter @agentops/crm deploy --prod --legacy /out/crm

# ---- runtime images ----
FROM node:24-alpine AS node-runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
USER node
ENTRYPOINT ["/sbin/tini", "--"]

FROM node-runtime AS gateway
COPY --from=build --chown=node:node /out/gateway/package.json ./
COPY --from=build --chown=node:node /out/gateway/node_modules ./node_modules
COPY --from=build --chown=node:node /out/gateway/dist ./dist
COPY --from=build --chown=node:node /out/gateway/drizzle ./drizzle
ENV PORT=4000 RUN_MIGRATIONS=true
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "dist/src/main.js"]

FROM node-runtime AS crm
COPY --from=build --chown=node:node /out/crm/package.json ./
COPY --from=build --chown=node:node /out/crm/node_modules ./node_modules
COPY --from=build --chown=node:node /out/crm/dist ./dist
COPY --from=build --chown=node:node /out/crm/drizzle ./drizzle
ENV PORT=3000 RUN_MIGRATIONS=true
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "dist/main.js"]

FROM nginx:1.29-alpine AS web
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# CRM_UPSTREAM is substituted into the template at container start.
ENV CRM_UPSTREAM=http://crm:3000 PORT=8080 NGINX_ENVSUBST_FILTER="^(CRM_UPSTREAM|PORT)$"
EXPOSE 8080

# ---- default target: chosen by APP ----
FROM ${APP} AS final
