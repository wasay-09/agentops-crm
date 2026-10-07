import {
  AgentConfig,
  CreateApiKeyRequest,
  CreatePromptVersionRequest,
  CreateTeamRequest,
  TaskType,
  type Team,
  TOOL_NAMES,
  UpdateBudgetRequest,
  UpdateDeploymentRequest,
  UpdateRoutingRequest,
  UpsertAgentRequest,
} from '@agentops/contracts';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { agents, apiKeys, routingPolicies, teams } from '../../db/schema.js';
import { generateApiKey, sha256 } from '../../lib/crypto.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse } from '../app.js';
import { requireScope } from '../auth.js';

export function toTeam(t: typeof teams.$inferSelect): Team {
  return {
    id: t.id,
    name: t.name,
    monthlyBudgetUsd: t.monthlyBudgetUsd,
    softLimitPct: t.softLimitPct,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Admin API: agents, prompts, routing, models, teams and keys. Requires the `admin` scope. */
export const adminRoutes: FastifyPluginAsync<{ onKeyChange: () => void }> = async (app, opts) => {
  const s = app.services;
  app.addHook('preHandler', requireScope('admin'));

  // ---- agents ----
  app.get('/agents', async () => ({
    agents: (await s.catalog.allAgents()).sort((a, b) => a.slug.localeCompare(b.slug)),
  }));

  app.post('/agents', async (req, reply) => {
    const body = parse(AgentConfig, req.body);
    await assertKnown(body);
    await s.db.insert(agents).values(body);
    s.catalog.invalidate();
    return reply.status(201).send({ agent: await s.catalog.agent(body.slug) });
  });

  app.put('/agents/:slug', async (req) => {
    const { slug } = parse(z.object({ slug: z.string() }), req.params);
    const body = parse(UpsertAgentRequest, req.body);
    if (!(await s.catalog.agent(slug))) throw notFound('Agent');
    await assertKnown(body);
    await s.db
      .update(agents)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(agents.slug, slug));
    s.catalog.invalidate();
    return { agent: await s.catalog.agent(slug) };
  });

  async function assertKnown(body: { taskType?: string; tools?: string[]; promptName?: string }) {
    if (body.taskType && !(await s.catalog.policy(body.taskType)))
      throw badRequest(`No routing policy for task type ${body.taskType}`);
    if (body.promptName) await s.prompts.get(body.promptName);
    const unknown = (body.tools ?? []).filter((t) => !(TOOL_NAMES as string[]).includes(t));
    if (unknown.length > 0) throw badRequest(`Unknown tools: ${unknown.join(', ')}`);
  }

  // ---- prompts ----
  app.get('/prompts', async () => ({ prompts: await s.prompts.list() }));

  app.get('/prompts/:name', async (req) => {
    const { name } = parse(z.object({ name: z.string() }), req.params);
    return { prompt: await s.prompts.get(name) };
  });

  app.post('/prompts/:name/versions', async (req, reply) => {
    const { name } = parse(z.object({ name: z.string() }), req.params);
    const body = parse(CreatePromptVersionRequest, req.body);
    return reply
      .status(201)
      .send({ prompt: await s.prompts.createVersion(name, body.template, body.notes, body.createdBy) });
  });

  app.put('/prompts/:name/deployment', async (req) => {
    const { name } = parse(z.object({ name: z.string() }), req.params);
    const body = parse(UpdateDeploymentRequest, req.body);
    return { prompt: await s.prompts.setDeployment(name, body.weights, body.updatedBy) };
  });

  // ---- models & routing ----
  app.get('/models', async () => {
    const all = await s.catalog.allModels();
    return {
      mockFallback: s.config.LLM_MOCK_FALLBACK,
      models: all
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => ({
          id: m.id,
          provider: m.provider,
          modelName: m.modelName,
          tier: m.tier,
          inputUsdPerMTok: m.inputUsdPerMTok,
          outputUsdPerMTok: m.outputUsdPerMTok,
          enabled: m.enabled,
          available: s.providers.isAvailable(m.provider),
          circuitOpen: s.breaker.isOpen(m.id),
        })),
    };
  });

  app.get('/routing', async () => ({
    policies: (await s.catalog.allPolicies()).sort((a, b) => a.taskType.localeCompare(b.taskType)),
  }));

  app.put('/routing/:taskType', async (req) => {
    const { taskType } = parse(z.object({ taskType: TaskType }), req.params);
    const body = parse(UpdateRoutingRequest, req.body);
    const ids = [...(body.chain ?? []), ...(body.budgetModel ? [body.budgetModel] : [])];
    for (const id of ids) if (!(await s.catalog.model(id))) throw badRequest(`Unknown model ${id}`);
    const updated = await s.db
      .update(routingPolicies)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(routingPolicies.taskType, taskType))
      .returning();
    if (updated.length === 0) throw notFound('Routing policy');
    s.catalog.invalidate();
    return { policy: await s.catalog.policy(taskType) };
  });

  // ---- teams, budgets, keys ----
  app.get('/teams', async () => ({
    teams: (await s.db.select().from(teams).orderBy(asc(teams.name))).map(toTeam),
  }));

  app.post('/teams', async (req, reply) => {
    const body = parse(CreateTeamRequest, req.body);
    const [team] = await s.db.insert(teams).values(body).returning();
    return reply.status(201).send({ team: toTeam(team!) });
  });

  app.put('/teams/:id/budget', async (req) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(UpdateBudgetRequest, req.body);
    const [team] = await s.db.update(teams).set(body).where(eq(teams.id, id)).returning();
    if (!team) throw notFound('Team');
    return { team: toTeam(team), budget: await s.budget.status(id) };
  });

  /** The plaintext key is returned once; only its hash is stored. */
  app.post('/teams/:id/keys', async (req, reply) => {
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const body = parse(CreateApiKeyRequest, req.body);
    const [team] = await s.db.select().from(teams).where(eq(teams.id, id));
    if (!team) throw notFound('Team');
    const { key, prefix } = generateApiKey();
    const [row] = await s.db
      .insert(apiKeys)
      .values({ teamId: id, name: body.name, prefix, keyHash: sha256(key), scopes: body.scopes })
      .returning({ id: apiKeys.id });
    opts.onKeyChange();
    return reply.status(201).send({ id: row!.id, prefix, key });
  });
};
