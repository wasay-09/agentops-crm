import { z } from 'zod';

/**
 * CRM tool API contract. The gateway exposes these to agents as tool definitions
 * (JSON Schema generated from the args schemas); the CRM implements them at POST /tools/:name.
 */

export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'] as const;
export const DealStage = z.enum(DEAL_STAGES);
export type DealStage = z.infer<typeof DealStage>;

export const ContactSummary = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  company: z.string(),
  title: z.string().nullable(),
});
export type ContactSummary = z.infer<typeof ContactSummary>;

export const Deal = z.object({
  id: z.number().int(),
  contactId: z.number().int(),
  title: z.string(),
  valueUsd: z.number(),
  stage: DealStage,
  updatedAt: z.string(),
});
export type Deal = z.infer<typeof Deal>;

export const Note = z.object({
  id: z.number().int(),
  contactId: z.number().int(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
});
export type Note = z.infer<typeof Note>;

export const ContactDetail = ContactSummary.extend({
  phone: z.string().nullable(),
  createdAt: z.string(),
  deals: z.array(Deal),
  notes: z.array(Note),
});
export type ContactDetail = z.infer<typeof ContactDetail>;

// ---- tool args / results ----

export const SearchContactsArgs = z
  .object({
    query: z.string().min(1).max(100).describe('Name, email or company to search for'),
    limit: z.number().int().min(1).max(20).optional().describe('Max results, default 5'),
  })
  .strict();
export const SearchContactsResult = z.object({ contacts: z.array(ContactSummary) });

export const GetContactArgs = z
  .object({ contactId: z.number().int().positive().describe('CRM contact id') })
  .strict();
export const GetContactResult = z.object({ contact: ContactDetail });

export const ListDealsArgs = z
  .object({
    stage: DealStage.optional().describe('Only deals in this stage'),
    contactId: z.number().int().positive().optional().describe('Only deals for this contact'),
  })
  .strict();
export const ListDealsResult = z.object({ deals: z.array(Deal) });

export const AddNoteArgs = z
  .object({
    contactId: z.number().int().positive().describe('CRM contact id'),
    body: z.string().min(1).max(2000).describe('Note text to save on the contact'),
  })
  .strict();
export const AddNoteResult = z.object({ note: Note });

export const MoveDealStageArgs = z
  .object({
    dealId: z.number().int().positive().describe('CRM deal id'),
    stage: DealStage.describe('Target pipeline stage'),
  })
  .strict();
export const MoveDealStageResult = z.object({ deal: Deal });

export type ToolMode = 'read' | 'write';

export interface ToolContract<A extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  mode: ToolMode;
  args: A;
  result: R;
}

export const TOOL_CONTRACTS = {
  search_contacts: {
    name: 'search_contacts',
    description: 'Search CRM contacts by name, email or company. Returns basic contact info.',
    mode: 'read',
    args: SearchContactsArgs,
    result: SearchContactsResult,
  },
  get_contact: {
    name: 'get_contact',
    description: 'Get one contact with their deals and most recent notes.',
    mode: 'read',
    args: GetContactArgs,
    result: GetContactResult,
  },
  list_deals: {
    name: 'list_deals',
    description: 'List deals, optionally filtered by stage or contact.',
    mode: 'read',
    args: ListDealsArgs,
    result: ListDealsResult,
  },
  add_note: {
    name: 'add_note',
    description: 'Add a note to a contact. Requires human approval before it is saved.',
    mode: 'write',
    args: AddNoteArgs,
    result: AddNoteResult,
  },
  move_deal_stage: {
    name: 'move_deal_stage',
    description: 'Move a deal to another pipeline stage. Requires human approval.',
    mode: 'write',
    args: MoveDealStageArgs,
    result: MoveDealStageResult,
  },
} as const satisfies Record<string, ToolContract>;

export type ToolName = keyof typeof TOOL_CONTRACTS;
export const TOOL_NAMES = Object.keys(TOOL_CONTRACTS) as ToolName[];
export const ToolNameSchema = z.enum(TOOL_NAMES as [ToolName, ...ToolName[]]);

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_CONTRACTS, name);
}

/** Envelope returned by the CRM for every POST /tools/:name call. */
export const ToolResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export type ToolResponse = z.infer<typeof ToolResponse>;

/** Headers the gateway sends on tool calls. */
export const TOOL_HEADERS = {
  actor: 'x-agentops-actor',
  runId: 'x-agentops-run-id',
  team: 'x-agentops-team',
} as const;
