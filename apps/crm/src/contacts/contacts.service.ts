import type { ContactDetail, ContactSummary, Deal, DealStage, Note } from '@agentops/contracts';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, notInArray, or, type SQL, sql } from 'drizzle-orm';
import { toContactSummary, toDeal, toNote } from '../common/serialize.js';
import { DB, type Db } from '../db/client.js';
import { contacts, deals, notes } from '../db/schema.js';

const CLOSED: DealStage[] = ['won', 'lost'];

export const notFound = (what: string, id: number) =>
  new NotFoundException({ error: { code: 'not_found', message: `${what} ${id} not found` } });

/** Escapes LIKE wildcards so user input matches literally. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' &&
  e !== null &&
  ((e as { code?: string }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505');

export interface ContactInput {
  name: string;
  email: string;
  company: string;
  title?: string;
  phone?: string;
}

@Injectable()
export class ContactsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private searchFilter(q?: string): SQL | undefined {
    const term = q?.trim();
    if (!term) return undefined;
    const p = likePattern(term);
    return or(ilike(contacts.name, p), ilike(contacts.email, p), ilike(contacts.company, p));
  }

  /** Contacts with open-deal count and open pipeline value, for the CRM list view. */
  async list(q?: string) {
    const rows = await this.db
      .select({
        contact: contacts,
        openDeals: sql<number>`count(${deals.id}) filter (where ${deals.stage} not in ('won','lost'))::int`,
        pipelineUsd: sql<number>`coalesce(sum(${deals.valueUsd}) filter (where ${deals.stage} not in ('won','lost')), 0)::int`,
      })
      .from(contacts)
      .leftJoin(deals, eq(deals.contactId, contacts.id))
      .where(this.searchFilter(q))
      .groupBy(contacts.id)
      .orderBy(asc(contacts.name));
    return rows.map((r) => ({
      ...toContactSummary(r.contact),
      openDeals: r.openDeals,
      pipelineUsd: r.pipelineUsd,
    }));
  }

  async search(query: string, limit = 5): Promise<ContactSummary[]> {
    const rows = await this.db
      .select()
      .from(contacts)
      .where(this.searchFilter(query))
      .orderBy(asc(contacts.name))
      .limit(limit);
    return rows.map(toContactSummary);
  }

  async get(id: number): Promise<ContactDetail> {
    const [contact] = await this.db.select().from(contacts).where(eq(contacts.id, id));
    if (!contact) throw notFound('Contact', id);
    const [dealRows, noteRows] = await Promise.all([
      this.db
        .select()
        .from(deals)
        .where(eq(deals.contactId, id))
        .orderBy(desc(deals.updatedAt), desc(deals.id)),
      this.db
        .select()
        .from(notes)
        .where(eq(notes.contactId, id))
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(10),
    ]);
    return {
      ...toContactSummary(contact),
      phone: contact.phone,
      createdAt: contact.createdAt.toISOString(),
      deals: dealRows.map(toDeal),
      notes: noteRows.map(toNote),
    };
  }

  async create(input: ContactInput): Promise<ContactDetail> {
    try {
      const [row] = await this.db
        .insert(contacts)
        .values({ ...input, email: input.email.toLowerCase() })
        .returning({ id: contacts.id });
      return this.get(row!.id);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: { code: 'conflict', message: 'A contact with this email exists' },
        });
      }
      throw e;
    }
  }

  async update(id: number, input: Partial<ContactInput>): Promise<ContactDetail> {
    try {
      const patch = {
        ...input,
        ...(input.email ? { email: input.email.toLowerCase() } : {}),
        updatedAt: new Date(),
      };
      const [row] = await this.db
        .update(contacts)
        .set(patch)
        .where(eq(contacts.id, id))
        .returning({ id: contacts.id });
      if (!row) throw notFound('Contact', id);
      return this.get(id);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: { code: 'conflict', message: 'A contact with this email exists' },
        });
      }
      throw e;
    }
  }

  async addNote(contactId: number, body: string, author: string): Promise<Note> {
    const [contact] = await this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, contactId));
    if (!contact) throw notFound('Contact', contactId);
    const [row] = await this.db.insert(notes).values({ contactId, body, author }).returning();
    return toNote(row!);
  }

  async listDeals(filter: { stage?: DealStage; contactId?: number; openOnly?: boolean } = {}) {
    const where = and(
      filter.stage ? eq(deals.stage, filter.stage) : undefined,
      filter.contactId ? eq(deals.contactId, filter.contactId) : undefined,
      filter.openOnly ? notInArray(deals.stage, CLOSED) : undefined,
    );
    const rows = await this.db
      .select({ deal: deals, contactName: contacts.name })
      .from(deals)
      .innerJoin(contacts, eq(contacts.id, deals.contactId))
      .where(where)
      .orderBy(desc(deals.updatedAt), desc(deals.id));
    return rows.map((r) => ({ ...toDeal(r.deal), contactName: r.contactName }));
  }

  async moveDealStage(id: number, stage: DealStage): Promise<Deal> {
    const [row] = await this.db
      .update(deals)
      .set({ stage, updatedAt: new Date() })
      .where(eq(deals.id, id))
      .returning();
    if (!row) throw notFound('Deal', id);
    return toDeal(row);
  }
}
