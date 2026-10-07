import { TOOL_HEADERS } from '@agentops/contracts';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { ToolTokenGuard } from './tool-token.guard.js';
import { ToolsService } from './tools.service.js';

/** Agent tool API called by the AI gateway. Not for browsers: service token only. */
@Public()
@UseGuards(ToolTokenGuard)
@Controller('tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  manifest() {
    return { tools: this.tools.manifest() };
  }

  @Post(':name')
  @HttpCode(200)
  execute(@Param('name') name: string, @Body() body: unknown, @Headers(TOOL_HEADERS.actor) actor?: string) {
    return this.tools.execute(name, body, { actor: actor?.trim() || undefined });
  }
}
