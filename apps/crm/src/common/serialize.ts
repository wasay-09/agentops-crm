import type { ContactSummary, Deal, Note } from '@agentops/contracts';
import type { contacts, deals, notes } from '../db/schema.js';

type ContactRow = typeof contacts.$inferSelect;
type DealRow = typeof deals.$inferSelect;
type NoteRow = typeof notes.$inferSelect;

export const toContactSummary = (c: ContactRow): ContactSummary => ({
  id: c.id,
  name: c.name,
  email: c.email,
  company: c.company,
  title: c.title,
});

export const toDeal = (d: DealRow): Deal => ({
  id: d.id,
  contactId: d.contactId,
  title: d.title,
  valueUsd: d.valueUsd,
  stage: d.stage,
  updatedAt: d.updatedAt.toISOString(),
});

export const toNote = (n: NoteRow): Note => ({
  id: n.id,
  contactId: n.contactId,
  body: n.body,
  author: n.author,
  createdAt: n.createdAt.toISOString(),
});
