import { fnv1a } from '../lib/crypto.js';
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  estimateRequestTokens,
  type LlmProvider,
  type ToolCallRequest,
} from './types.js';

/**
 * Deterministic, rule-based stand-in for an LLM. It lets the gateway, CRM integration, dashboard and
 * CI evals run with no API keys. It follows simple intents from the latest user message, calls the
 * same tools a real model would, and writes answers from tool results. It never acts on text found
 * inside tool results (that is the prompt-injection behaviour we want from real models too).
 *
 * It is a simulator for plumbing, not a quality signal: live evals use real providers.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';

  constructor(private readonly latencyMs = 0) {}

  isConfigured(): boolean {
    return true;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (this.latencyMs > 0) {
      const jitter =
        fnv1a(JSON.stringify(req.messages.at(-1) ?? '')) % Math.max(1, Math.floor(this.latencyMs / 2));
      await new Promise((r) => setTimeout(r, this.latencyMs + jitter));
    }
    const decision = decide(req);
    const outputChars = decision.text.length + JSON.stringify(decision.toolCalls).length;
    return {
      text: decision.text,
      toolCalls: decision.toolCalls,
      stopReason: decision.toolCalls.length > 0 ? 'tool_use' : 'end',
      usage: {
        inputTokens: estimateRequestTokens(req),
        outputTokens: Math.max(1, Math.ceil(outputChars / 4)),
      },
    };
  }
}

interface Decision {
  text: string;
  toolCalls: ToolCallRequest[];
}

interface ToolOutcome {
  name: string;
  args: unknown;
  content: string;
  isError: boolean;
  data: unknown;
}

function decide(req: ChatRequest): Decision {
  const lastUserIdx = findLastIndex(req.messages, (m) => m.role === 'user');
  const userText = lastUserIdx >= 0 ? (req.messages[lastUserIdx] as { content: string }).content : '';
  const since = req.messages.slice(lastUserIdx + 1);
  const called = new Map<string, ToolCallRequest>();
  for (const m of since) if (m.role === 'assistant') for (const tc of m.toolCalls) called.set(tc.name, tc);
  const outcomes = collectOutcomes(since);
  const toolNames = new Set(req.tools.map((t) => t.name));

  if (toolNames.size === 0) return { text: noToolAnswer(req.system, userText), toolCalls: [] };

  const text = userText.toLowerCase();
  const contactId = findContactId(req.system, userText);
  const intents = {
    note: /\b(add|log|save|write|leave|record)\b[^.?!]*\bnote\b/.test(text),
    move: /\b(move|advance|mark|change|set)\b[^.?!]*\b(deal|stage|qualified|proposal|won|lost)\b/.test(text),
    search: /\b(find|search|look up|lookup|who is|who's)\b/.test(text),
    deals: /\b(deals?|pipeline)\b/.test(text),
  };

  const call = (name: string, args: unknown): Decision => ({
    text:
      name === 'add_note'
        ? "I'll add that note to the contact. It's waiting for approval before it's saved."
        : name === 'move_deal_stage'
          ? "I'll move the deal. The change is waiting for approval."
          : '',
    toolCalls: [
      {
        id: `mock_${name}_${fnv1a(JSON.stringify([req.messages.length, name, args])).toString(16)}`,
        name,
        args,
      },
    ],
  });

  if (contactId && toolNames.has('get_contact') && !called.has('get_contact'))
    return call('get_contact', { contactId });
  if (!contactId && intents.search && toolNames.has('search_contacts') && !called.has('search_contacts')) {
    return call('search_contacts', { query: extractQuery(userText), limit: 5 });
  }
  if (
    !contactId &&
    intents.deals &&
    !intents.search &&
    toolNames.has('list_deals') &&
    !called.has('list_deals')
  ) {
    const stage = /\b(lead|qualified|proposal|won|lost)\b/.exec(text)?.[1];
    return call('list_deals', stage ? { stage } : {});
  }
  if (intents.note && contactId && toolNames.has('add_note') && !called.has('add_note')) {
    return call('add_note', { contactId, body: extractNoteBody(userText) });
  }
  if (intents.move && toolNames.has('move_deal_stage') && !called.has('move_deal_stage')) {
    const deal = openDealFrom(outcomes);
    const stage = /\b(qualified|proposal|won|lost)\b/.exec(text)?.[1] ?? 'qualified';
    if (deal) return call('move_deal_stage', { dealId: deal.id, stage });
  }

  return { text: finalAnswer(req.system, userText, outcomes), toolCalls: [] };
}

function collectOutcomes(messages: ChatMessage[]): ToolOutcome[] {
  const argsById = new Map<string, ToolCallRequest>();
  const out: ToolOutcome[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') for (const tc of m.toolCalls) argsById.set(tc.id, tc);
    if (m.role === 'tool') {
      let data: unknown = null;
      try {
        data = JSON.parse(m.content);
      } catch {
        data = null;
      }
      out.push({
        name: m.name,
        args: argsById.get(m.toolCallId)?.args,
        content: m.content,
        isError: m.isError ?? false,
        data,
      });
    }
  }
  return out;
}

interface ContactLike {
  id: number;
  name: string;
  title: string | null;
  company: string;
  deals?: { id: number; title: string; valueUsd: number; stage: string }[];
  notes?: { body: string; createdAt: string }[];
}

function contactFrom(outcomes: ToolOutcome[]): ContactLike | null {
  for (const o of outcomes) {
    const c = (o.data as { contact?: ContactLike } | null)?.contact;
    if (o.name === 'get_contact' && c) return c;
  }
  return null;
}

function openDealFrom(outcomes: ToolOutcome[]) {
  return contactFrom(outcomes)?.deals?.find((d) => d.stage !== 'won' && d.stage !== 'lost') ?? null;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function finalAnswer(system: string, userText: string, outcomes: ToolOutcome[]): string {
  const contact = contactFrom(outcomes);
  const lines: string[] = [];
  let summary = '';
  let nextStep = 'Schedule a short call to confirm requirements and timeline.';

  const failed = outcomes.find((o) => o.isError && !o.content.includes('rejected'));
  if (contact) {
    const open = (contact.deals ?? []).filter((d) => d.stage !== 'won' && d.stage !== 'lost');
    const dealText = open.length
      ? open.map((d) => `${d.title} (${usd(d.valueUsd)}, ${d.stage})`).join('; ')
      : 'no open deals';
    summary = `${contact.name} is ${contact.title ?? 'a contact'} at ${contact.company}, with ${dealText}.`;
    const latest = contact.notes?.[0];
    if (latest) lines.push(`Latest note: "${truncate(latest.body, 140)}"`);
    if (open[0]?.stage === 'lead')
      nextStep = `Qualify ${open[0].title}: confirm budget, decision maker and timeline.`;
    else if (open[0]?.stage === 'proposal') nextStep = `Follow up on the proposal for ${open[0].title}.`;
  } else {
    const search = outcomes.find((o) => o.name === 'search_contacts');
    const deals = outcomes.find((o) => o.name === 'list_deals');
    if (search) {
      const found = (search.data as { contacts?: ContactLike[] } | null)?.contacts ?? [];
      summary = found.length
        ? `Found ${found.length} contact${found.length === 1 ? '' : 's'}: ${found.map((c) => `${c.name} (${c.company}, #${c.id})`).join(', ')}.`
        : 'I could not find any matching contacts.';
    } else if (deals) {
      const list =
        (deals.data as { deals?: { title: string; valueUsd: number; stage: string }[] } | null)?.deals ?? [];
      const total = list.reduce((s, d) => s + d.valueUsd, 0);
      summary = list.length
        ? `There are ${list.length} deals worth ${usd(total)} in total.`
        : 'There are no matching deals.';
      for (const d of list.slice(0, 3)) lines.push(`${d.title}: ${usd(d.valueUsd)} (${d.stage})`);
    } else if (failed) {
      summary = 'I could not complete that because a CRM lookup failed.';
    } else {
      summary = `I can help with contacts, deals and notes. You asked: "${truncate(userText, 80)}".`;
    }
  }

  for (const o of outcomes) {
    if (o.name !== 'add_note' && o.name !== 'move_deal_stage') continue;
    const what = o.name === 'add_note' ? 'The note' : 'The deal stage change';
    if (o.content.includes('rejected'))
      lines.push(`${what} was rejected by the reviewer, so nothing was changed.`);
    else if (o.isError) lines.push(`${what} could not be saved.`);
    else lines.push(`${what} was approved and saved.`);
  }

  if (contact && system.includes('- Who:')) {
    const open = (contact.deals ?? []).filter((d) => d.stage !== 'won' && d.stage !== 'lost');
    return [
      `- Who: ${contact.name}, ${contact.title ?? 'Contact'} at ${contact.company}`,
      `- Deals: ${open.length ? open.map((d) => `${d.title} (${d.stage}, ${usd(d.valueUsd)})`).join('; ') : 'none'}`,
      `- Recent activity: ${contact.notes?.[0] ? truncate(contact.notes[0].body, 160) : 'no recent notes'}`,
      `- Next step: ${nextStep}`,
    ].join('\n');
  }

  if (system.includes('Next step:')) {
    return [`Summary: ${summary}`, ...lines.map((l) => `- ${l}`), `Next step: ${nextStep}`].join('\n');
  }
  return [summary, ...lines.map((l) => `- ${l}`), `- Suggested next step: ${nextStep}`].join('\n');
}

/** Agents without tools: email drafts, or plain summaries for /v1/complete. */
function noToolAnswer(system: string, userText: string): string {
  if (/email/i.test(system)) {
    const who =
      /Who:\s*([^,\n]+)(?:,\s*([^\n]+?))?\s+at\s+([^\n.]+)/i.exec(userText) ??
      /Who:\s*([^\n,]+)/i.exec(userText);
    const name = who?.[1]?.trim() ?? 'there';
    const first = name.split(/\s+/)[0] ?? name;
    const company = who?.[3]?.trim();
    const deal = /Deals:\s*([^\n]+)/i.exec(userText)?.[1]?.trim();
    return [
      `Subject: Next steps${company ? ` for ${company}` : ''}`,
      '',
      `Hi ${first},`,
      '',
      `Thanks again for your time recently. ${deal && !/none/i.test(deal) ? `I wanted to follow up on ${deal.split('(')[0]?.trim()}.` : 'I wanted to follow up on our conversation.'} Would you have 20 minutes this week to walk through your requirements and timeline?`,
      '',
      'Best regards,',
      '[Your name]',
    ].join('\n');
  }
  if (/brief|summar/i.test(system) || /summar/i.test(userText)) {
    const sentences = userText
      .split(/(?<=[.!?])\s+/)
      .slice(0, 2)
      .join(' ');
    return `Summary: ${truncate(sentences, 300)}`;
  }
  if (/classif/i.test(system)) return 'other';
  return `Acknowledged: ${truncate(userText, 200)}`;
}

function findContactId(system: string, userText: string): number | null {
  const fromContext = /"contactId"\s*:\s*(\d+)/.exec(system) ?? /"contactId"\s*:\s*(\d+)/.exec(userText);
  const fromText = /\bcontact\s*(?:#|id\s*)?(\d+)\b/i.exec(userText);
  const raw = fromContext?.[1] ?? fromText?.[1];
  return raw ? Number(raw) : null;
}

function extractQuery(text: string): string {
  const quoted = /["“']([^"”']{2,60})["”']/.exec(text)?.[1];
  if (quoted) return quoted;
  const after =
    /\b(?:find|search(?: for)?|look up|lookup|who is|who's)\s+(?:contacts?\s+(?:at|from|named)\s+)?([A-Za-z][\w&.\- ]{1,50})/i.exec(
      text,
    )?.[1];
  return (
    (after ?? text)
      .replace(/[?.!]+$/, '')
      .trim()
      .slice(0, 60) || 'a'
  );
}

function extractNoteBody(text: string): string {
  const quoted = /["“]([^"”]{2,500})["”]/.exec(text)?.[1];
  if (quoted) return quoted;
  const after = /\bnote\b\s*(?:that\b|saying\b|:)?\s*(.{2,500})/i.exec(text)?.[1];
  const body = (after ?? text).trim().replace(/[.]+$/, '');
  return body.charAt(0).toUpperCase() + body.slice(1);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i] as T)) return i;
  return -1;
}
