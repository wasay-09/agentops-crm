import type { ContactDetail, ToolName } from '@agentops/contracts';
import { z } from 'zod';

export type WorkflowContext = Record<string, unknown> & { input: Record<string, unknown> };

interface StepBase {
  id: string;
  label: string;
  /** Skip the step when this returns false. */
  when?: (ctx: WorkflowContext) => boolean;
  /** Key in the context where the step's output is stored. */
  saveAs?: string;
}

export interface AgentStep extends StepBase {
  type: 'agent';
  agent: string;
  input: (ctx: WorkflowContext) => string;
  context?: (ctx: WorkflowContext) => Record<string, unknown>;
}

export interface ApprovalStep extends StepBase {
  type: 'approval';
  title: (ctx: WorkflowContext) => string;
  payload: (ctx: WorkflowContext) => Record<string, unknown>;
}

export interface ToolStep extends StepBase {
  type: 'tool';
  tool: ToolName;
  args: (ctx: WorkflowContext) => unknown;
}

export type WorkflowStep = AgentStep | ApprovalStep | ToolStep;

export interface WorkflowDefinition {
  name: string;
  description: string;
  input: z.ZodType<Record<string, unknown>>;
  steps: WorkflowStep[];
}

const contactOf = (ctx: WorkflowContext) => (ctx.contact as { contact: ContactDetail } | undefined)?.contact;
const openLeadDeal = (ctx: WorkflowContext) => contactOf(ctx)?.deals.find((d) => d.stage === 'lead');

/**
 * Lead follow-up: deterministic steps (lookups, approvals, writes) around two agent steps.
 * Agents do the language work; code does the control flow and the side effects.
 */
export const leadFollowUp: WorkflowDefinition = {
  name: 'lead-follow-up',
  description: 'Summarise a lead, draft a follow-up email, get approval, log it and advance the deal.',
  input: z.object({ contactId: z.number().int().positive() }),
  steps: [
    {
      id: 'lookup',
      type: 'tool',
      label: 'Load contact from CRM',
      tool: 'get_contact',
      args: (ctx) => ({ contactId: ctx.input.contactId }),
      saveAs: 'contact',
    },
    {
      id: 'summarize',
      type: 'agent',
      label: 'Summarise lead',
      agent: 'lead-summarizer',
      input: (ctx) => `Write the lead brief for contact ${ctx.input.contactId}.`,
      context: (ctx) => ({ contactId: ctx.input.contactId }),
      saveAs: 'summary',
    },
    {
      id: 'draft',
      type: 'agent',
      label: 'Draft follow-up email',
      agent: 'email-drafter',
      input: (ctx) => `Lead brief:\n${String(ctx.summary)}`,
      saveAs: 'draft',
    },
    {
      id: 'approve',
      type: 'approval',
      label: 'Approve email',
      title: (ctx) => `Send follow-up email to ${contactOf(ctx)?.name ?? `contact #${ctx.input.contactId}`}`,
      payload: (ctx) => ({
        contactId: ctx.input.contactId,
        to: contactOf(ctx)?.email,
        draft: ctx.draft,
        summary: ctx.summary,
      }),
    },
    {
      id: 'log',
      type: 'tool',
      label: 'Log email on contact',
      tool: 'add_note',
      args: (ctx) => ({
        contactId: ctx.input.contactId,
        body: `Follow-up email approved and sent:\n\n${String(ctx.draft)}`.slice(0, 2000),
      }),
      saveAs: 'note',
    },
    {
      id: 'advance',
      type: 'tool',
      label: 'Move lead deal to qualified',
      tool: 'move_deal_stage',
      when: (ctx) => openLeadDeal(ctx) !== undefined,
      args: (ctx) => ({ dealId: openLeadDeal(ctx)!.id, stage: 'qualified' }),
      saveAs: 'deal',
    },
  ],
};

export const WORKFLOWS: Record<string, WorkflowDefinition> = { [leadFollowUp.name]: leadFollowUp };
