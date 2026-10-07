import {
  AskAiRequest,
  CreatePromptVersionRequest,
  CrmDecideApprovalRequest,
  FollowUpRequest,
  TaskType,
  UpdateBudgetRequest,
  UpdateDeploymentRequest,
  UpdateRoutingRequest,
  UpsertAgentRequest,
} from '@agentops/contracts';
import { Body, Controller, Get, Headers, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import { AdminGuard } from '../auth/admin.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  GatewayClient,
  type GatewayRequest,
  type GatewayResponse,
  LONG_TIMEOUT_MS,
} from './gateway.client.js';

const seg = (s: string) => encodeURIComponent(s);
type QueryParams = Record<string, unknown>;

/**
 * Proxies AI features to the gateway, the way an existing CRM backend (e.g. a Laravel app) would.
 * The browser never holds gateway keys; actor/decidedBy come from the CRM session, not the client.
 */
@Controller('ai')
export class AiController {
  constructor(private readonly gateway: GatewayClient) {}

  private async forward(res: Response, req: GatewayRequest): Promise<void> {
    send(res, await this.gateway.request(req));
  }

  @Post('ask')
  ask(
    @Body(new ZodValidationPipe(AskAiRequest)) body: z.infer<typeof AskAiRequest>,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ) {
    return this.forward(res, {
      method: 'POST',
      path: '/v1/runs',
      body: {
        agent: 'crm-assistant',
        input: body.question,
        ...(body.contactId ? { context: { contactId: body.contactId } } : {}),
        actor: user.email,
      },
      timeoutMs: LONG_TIMEOUT_MS,
      idempotencyKey,
    });
  }

  @Post('follow-up')
  followUp(
    @Body(new ZodValidationPipe(FollowUpRequest)) body: z.infer<typeof FollowUpRequest>,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res() res: Response,
  ) {
    return this.forward(res, {
      method: 'POST',
      path: '/v1/workflows/lead-follow-up/runs',
      body: { input: { contactId: body.contactId }, actor: user.email },
      timeoutMs: LONG_TIMEOUT_MS,
      idempotencyKey,
    });
  }

  @Get('runs')
  runs(@Query() query: QueryParams, @Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/runs', query });
  }

  @Get('runs/:id')
  run(@Param('id') id: string, @Res() res: Response) {
    return this.forward(res, { method: 'GET', path: `/v1/runs/${seg(id)}` });
  }

  @Get('workflow-runs/:id')
  workflowRun(@Param('id') id: string, @Res() res: Response) {
    return this.forward(res, { method: 'GET', path: `/v1/workflows/runs/${seg(id)}` });
  }

  @Get('approvals')
  approvals(@Query() query: QueryParams, @Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/approvals', query });
  }

  @Post('approvals/:id')
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CrmDecideApprovalRequest)) body: z.infer<typeof CrmDecideApprovalRequest>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    return this.forward(res, {
      method: 'POST',
      path: `/v1/approvals/${seg(id)}`,
      body: { decision: body.decision, note: body.note, decidedBy: user.email },
      timeoutMs: LONG_TIMEOUT_MS,
    });
  }

  @Get('usage')
  usage(@Query('days') days: string | undefined, @Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/usage/summary', query: { days } });
  }

  // ---------- admin (CRM admin role, platform admin key) ----------

  @UseGuards(AdminGuard)
  @Get('admin/prompts')
  prompts(@Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/admin/prompts', key: 'admin' });
  }

  @UseGuards(AdminGuard)
  @Get('admin/prompts/:name')
  prompt(@Param('name') name: string, @Res() res: Response) {
    return this.forward(res, { method: 'GET', path: `/v1/admin/prompts/${seg(name)}`, key: 'admin' });
  }

  @UseGuards(AdminGuard)
  @Post('admin/prompts/:name/versions')
  createVersion(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(CreatePromptVersionRequest)) body: z.infer<typeof CreatePromptVersionRequest>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    return this.forward(res, {
      method: 'POST',
      path: `/v1/admin/prompts/${seg(name)}/versions`,
      body: { ...body, createdBy: user.email },
      key: 'admin',
    });
  }

  @UseGuards(AdminGuard)
  @Put('admin/prompts/:name/deployment')
  deploy(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(UpdateDeploymentRequest)) body: z.infer<typeof UpdateDeploymentRequest>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    return this.forward(res, {
      method: 'PUT',
      path: `/v1/admin/prompts/${seg(name)}/deployment`,
      body: { ...body, updatedBy: user.email },
      key: 'admin',
    });
  }

  @UseGuards(AdminGuard)
  @Get('admin/agents')
  agents(@Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/admin/agents', key: 'admin' });
  }

  @UseGuards(AdminGuard)
  @Put('admin/agents/:slug')
  updateAgent(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(UpsertAgentRequest)) body: z.infer<typeof UpsertAgentRequest>,
    @Res() res: Response,
  ) {
    return this.forward(res, { method: 'PUT', path: `/v1/admin/agents/${seg(slug)}`, body, key: 'admin' });
  }

  @UseGuards(AdminGuard)
  @Get('admin/models')
  models(@Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/admin/models', key: 'admin' });
  }

  @UseGuards(AdminGuard)
  @Get('admin/routing')
  routing(@Res() res: Response) {
    return this.forward(res, { method: 'GET', path: '/v1/admin/routing', key: 'admin' });
  }

  @UseGuards(AdminGuard)
  @Put('admin/routing/:taskType')
  updateRouting(
    @Param('taskType', new ZodValidationPipe(TaskType)) taskType: z.infer<typeof TaskType>,
    @Body(new ZodValidationPipe(UpdateRoutingRequest)) body: z.infer<typeof UpdateRoutingRequest>,
    @Res() res: Response,
  ) {
    return this.forward(res, {
      method: 'PUT',
      path: `/v1/admin/routing/${seg(taskType)}`,
      body,
      key: 'admin',
    });
  }

  /** Updates the budget of the CRM's own team: resolve the team from its key, then use the admin key. */
  @UseGuards(AdminGuard)
  @Put('admin/budget')
  async budget(
    @Body(new ZodValidationPipe(UpdateBudgetRequest)) body: z.infer<typeof UpdateBudgetRequest>,
    @Res() res: Response,
  ) {
    const me = await this.gateway.request({ method: 'GET', path: '/v1/me' });
    const teamId = (me.body as { team?: { id?: unknown } } | null)?.team?.id;
    if (me.status !== 200 || typeof teamId !== 'string') {
      send(res, me.status === 200 ? badTeam() : me);
      return;
    }
    await this.forward(res, {
      method: 'PUT',
      path: `/v1/admin/teams/${seg(teamId)}/budget`,
      body,
      key: 'admin',
    });
  }
}

function badTeam(): GatewayResponse {
  return {
    status: 502,
    body: { error: { code: 'bad_gateway_response', message: 'Could not resolve team' } },
  };
}

function send(res: Response, { status, body }: GatewayResponse): void {
  if (body === null) res.status(status).end();
  else res.status(status).json(body);
}
