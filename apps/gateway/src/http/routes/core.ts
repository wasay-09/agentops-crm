import {
  CompleteRequest,
  CreateRunRequest,
  DecideApprovalRequest,
  ListApprovalsQuery,
  ListRunsQuery,
  StartWorkflowRequest,
  UsageSummaryQuery,
} from '@agentops/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sanitizeOutput } from '../../agents/sanitize.js';
import { teams } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import { withSpan } from '../../telemetry.js';
import { parse } from '../app.js';
import { requireScope } from '../auth.js';
import { toTeam } from './admin.js';

const IdParam = z.object({ id: z.uuid() });

export const coreRoutes: FastifyPluginAsync = async (app) => {
  const s = app.services;
  app.addHook('preHandler', requireScope('runs'));

  const faultModel = (req: FastifyRequest) => {
    const v = req.headers['x-fault-model'];
    return s.config.ALLOW_FAULT_INJECTION && typeof v === 'string' ? v : undefined;
  };
  const idempotencyKey = (req: FastifyRequest) => {
    const v = req.headers['idempotency-key'];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v.length < 8 || v.length > 200)
      throw badRequest('Idempotency-Key must be 8–200 characters');
    return v;
  };

  app.get('/me', async (req) => {
    const [team] = await s.db.select().from(teams).where(eq(teams.id, req.auth.teamId));
    return { team: toTeam(team!), scopes: req.auth.scopes };
  });

  // ---- runs ----
  app.post('/runs', async (req, reply) => {
    const body = parse(CreateRunRequest, req.body);
    const run = await s.runtime.start({
      teamId: req.auth.teamId,
      teamName: req.auth.teamName,
      agent: body.agent,
      input: body.input,
      context: body.context,
      actor: body.actor,
      idempotencyKey: idempotencyKey(req),
      faultModel: faultModel(req),
    });
    return reply.status(201).send(run);
  });

  app.get('/runs', async (req) => {
    const q = parse(ListRunsQuery, req.query);
    return { runs: await s.runs.list(req.auth.teamId, q) };
  });

  app.get('/runs/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    return s.runs.detail(id, req.auth.teamId);
  });

  // ---- approvals ----
  app.get('/approvals', async (req) => {
    const q = parse(ListApprovalsQuery, req.query);
    return { approvals: await s.approvals.list(req.auth.teamId, q.status, q.limit) };
  });

  app.post('/approvals/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(DecideApprovalRequest, req.body);
    return withSpan(
      'approval.decide',
      { 'agentops.approval_id': id, 'agentops.decision': body.decision },
      () =>
        s.approvals.decide(req.auth.teamId, req.auth.teamName, id, body.decision, body.decidedBy, body.note),
    );
  });

  // ---- workflows ----
  app.post('/workflows/:name/runs', async (req, reply) => {
    const { name } = parse(z.object({ name: z.string().min(1) }), req.params);
    const body = parse(StartWorkflowRequest, req.body);
    const run = await s.workflows.start(req.auth.teamId, req.auth.teamName, name, body.input, body.actor);
    return reply.status(201).send(run);
  });

  app.get('/workflows/runs/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    return s.workflows.get(id, req.auth.teamId);
  });

  // ---- plain routed completion (the "gateway" use case without an agent) ----
  app.post('/complete', async (req) => {
    const body = parse(CompleteRequest, req.body);
    const result = await withSpan('gateway.complete', { 'agentops.task_type': body.taskType }, () =>
      s.llm.call({
        teamId: req.auth.teamId,
        taskType: body.taskType,
        system: body.system ?? 'You are a helpful assistant.',
        messages: [{ role: 'user', content: body.prompt }],
        tools: [],
        step: 1,
        maxTokens: body.maxTokens,
        faultModel: faultModel(req),
      }),
    );
    return {
      text: sanitizeOutput(result.response.text),
      model: result.model.id,
      routingReason: result.routingReason,
      inputTokens: result.response.usage.inputTokens,
      outputTokens: result.response.usage.outputTokens,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
    };
  });

  // ---- usage ----
  app.get('/usage/summary', async (req) => {
    const q = parse(UsageSummaryQuery, req.query);
    return s.usage.summary({ id: req.auth.teamId, name: req.auth.teamName }, q.days);
  });
};
