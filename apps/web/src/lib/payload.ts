/** Helpers for reading approval payloads, whose exact shape depends on the approval kind. */

export interface ReadablePayload {
  tool: string | null;
  args: unknown;
  draft: { subject: string | null; body: string } | null;
  rest: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export function readPayload(payload: Record<string, unknown>): ReadablePayload {
  const tool = str(payload.toolName) ?? str(payload.tool) ?? str(payload.name);
  const args = payload.args ?? payload.arguments ?? payload.input ?? null;

  let draft: ReadablePayload['draft'] = null;
  const draftValue = payload.draft ?? payload.email;
  if (typeof draftValue === 'string') {
    draft = { subject: str(payload.subject), body: draftValue };
  } else if (draftValue && typeof draftValue === 'object') {
    const d = draftValue as Record<string, unknown>;
    const body = str(d.body) ?? str(d.text) ?? str(d.content);
    if (body) draft = { subject: str(d.subject), body };
  } else if (!tool && str(payload.body)) {
    draft = { subject: str(payload.subject), body: payload.body as string };
  }

  const known = new Set([
    'toolName',
    'tool',
    'name',
    'args',
    'arguments',
    'input',
    'draft',
    'email',
    'subject',
    'body',
  ]);
  const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => !known.has(k)));
  return { tool, args, draft, rest };
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
