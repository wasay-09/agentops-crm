import { describe, expect, it } from 'vitest';
import { readPayload } from './payload';

describe('readPayload', () => {
  it('reads tool calls', () => {
    const p = readPayload({ toolName: 'add_note', args: { contactId: 3, body: 'Call next week' } });
    expect(p.tool).toBe('add_note');
    expect(p.args).toEqual({ contactId: 3, body: 'Call next week' });
    expect(p.draft).toBeNull();
  });

  it('reads email drafts as string or object', () => {
    expect(readPayload({ draft: 'Hi Ana', subject: 'Follow-up' }).draft).toEqual({
      subject: 'Follow-up',
      body: 'Hi Ana',
    });
    expect(readPayload({ draft: { subject: 'S', body: 'B' }, contactId: 4 })).toMatchObject({
      draft: { subject: 'S', body: 'B' },
      rest: { contactId: 4 },
    });
  });
});
