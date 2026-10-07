import { z } from 'zod';
import { ContactDetail, ContactSummary, Deal, DealStage, Note } from './tools.js';

/** CRM API contract used by the web app. AI routes under /ai/* return gateway shapes. */

export const UserRole = z.enum(['admin', 'rep']);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({ id: z.number().int(), email: z.string(), name: z.string(), role: UserRole });
export type User = z.infer<typeof User>;

export const LoginRequest = z.object({ email: z.string().email(), password: z.string().min(1) });
export const LoginResponse = z.object({ token: z.string(), user: User });

export const ListContactsResponse = z.object({
  contacts: z.array(ContactSummary.extend({ openDeals: z.number().int(), pipelineUsd: z.number() })),
});
export const ContactResponse = z.object({ contact: ContactDetail });

export const CreateContactRequest = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().min(1),
  title: z.string().optional(),
  phone: z.string().optional(),
});
export const UpdateContactRequest = CreateContactRequest.partial();

export const ListDealsResponse = z.object({ deals: z.array(Deal.extend({ contactName: z.string() })) });
export const UpdateDealRequest = z.object({ stage: DealStage });
export const DealResponse = z.object({ deal: Deal });

export const CreateNoteRequest = z.object({ body: z.string().min(1).max(2000) });
export const NoteResponse = z.object({ note: Note });

/** POST /ai/ask */
export const AskAiRequest = z.object({
  question: z.string().min(1).max(4000),
  contactId: z.number().int().positive().optional(),
});
/** POST /ai/follow-up */
export const FollowUpRequest = z.object({ contactId: z.number().int().positive() });
/** POST /ai/approvals/:id (decidedBy comes from the session) */
export const CrmDecideApprovalRequest = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional(),
});
