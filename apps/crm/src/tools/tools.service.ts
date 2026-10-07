import { isToolName, TOOL_CONTRACTS, type ToolName } from '@agentops/contracts';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { formatZodError } from '../common/zod-validation.pipe.js';
import { ContactsService } from '../contacts/contacts.service.js';

const toolError = (code: string, message: string) => ({ ok: false as const, error: { code, message } });

export interface ToolContext {
  /** CRM user who approved the action (sent by the gateway for write tools). */
  actor?: string;
}

/**
 * Implements the agent tool API. Args are validated with the shared contract, and results are
 * parsed through the contract's result schema so the CRM can't drift from what agents expect.
 */
@Injectable()
export class ToolsService {
  constructor(private readonly contacts: ContactsService) {}

  manifest() {
    return Object.values(TOOL_CONTRACTS).map((t) => ({
      name: t.name,
      description: t.description,
      mode: t.mode,
      inputSchema: z.toJSONSchema(t.args),
    }));
  }

  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<{ ok: true; data: unknown }> {
    if (!isToolName(name)) {
      throw new NotFoundException(toolError('unknown_tool', `Unknown tool: ${name}`));
    }
    const contract = TOOL_CONTRACTS[name];
    const parsed = contract.args.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw new BadRequestException(toolError('invalid_args', formatZodError(parsed.error)));
    }
    try {
      const data = await this.run(name, parsed.data, ctx);
      return { ok: true, data: contract.result.parse(data) };
    } catch (e) {
      if (e instanceof NotFoundException) {
        const body = e.getResponse() as { error?: { message?: string } };
        throw new NotFoundException(toolError('not_found', body.error?.message ?? 'Not found'));
      }
      throw e;
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: args were validated against the tool's own schema above
  private async run(name: ToolName, args: any, ctx: ToolContext): Promise<unknown> {
    switch (name) {
      case 'search_contacts':
        return { contacts: await this.contacts.search(args.query, args.limit ?? 5) };
      case 'get_contact':
        return { contact: await this.contacts.get(args.contactId) };
      case 'list_deals': {
        const deals = await this.contacts.listDeals({ stage: args.stage, contactId: args.contactId });
        return { deals: deals.map(({ contactName: _omit, ...deal }) => deal) };
      }
      case 'add_note': {
        const author = ctx.actor ? `AI agent (approved by ${ctx.actor})` : 'AI agent';
        return { note: await this.contacts.addNote(args.contactId, args.body, author) };
      }
      case 'move_deal_stage':
        return { deal: await this.contacts.moveDealStage(args.dealId, args.stage) };
    }
  }
}
