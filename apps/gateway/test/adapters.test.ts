import { describe, expect, it } from 'vitest';
import { sanitizeOutput } from '../src/agents/sanitize.js';
import { toAnthropicMessages } from '../src/providers/anthropic.js';
import { toGeminiContents } from '../src/providers/gemini.js';
import { MockProvider } from '../src/providers/mock.js';
import { toOpenAiMessages } from '../src/providers/openai.js';
import type { ChatMessage, ModelSpec } from '../src/providers/types.js';
import { costUsd } from '../src/providers/types.js';
import { toolDefinitions } from '../src/tools/registry.js';

const conversation: ChatMessage[] = [
  { role: 'user', content: 'Look up 1 and 2' },
  {
    role: 'assistant',
    content: 'Checking.',
    toolCalls: [
      { id: 'a', name: 'get_contact', args: { contactId: 1 } },
      { id: 'b', name: 'get_contact', args: { contactId: 2 } },
    ],
    native: {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
    },
  },
  { role: 'tool', toolCallId: 'a', name: 'get_contact', content: '{"id":1}' },
  { role: 'tool', toolCallId: 'b', name: 'get_contact', content: 'not found', isError: true },
];

describe('Anthropic mapping', () => {
  it('groups parallel tool results into one user turn', () => {
    const out = toAnthropicMessages(conversation, 'claude-haiku-4-5');
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: '{"id":1}', is_error: false },
        { type: 'tool_result', tool_use_id: 'b', content: 'not found', is_error: true },
      ],
    });
    // A different model gets the normalized turn, not the other model's thinking blocks.
    expect(out[1]!.content).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'a', name: 'get_contact', input: { contactId: 1 } },
      { type: 'tool_use', id: 'b', name: 'get_contact', input: { contactId: 2 } },
    ]);
  });

  it('replays the native assistant turn verbatim for the same model', () => {
    const out = toAnthropicMessages(conversation, 'claude-sonnet-5-5');
    expect(out[1]!.content).toEqual([{ type: 'thinking', thinking: '', signature: 'sig' }]);
  });
});

describe('OpenAI mapping', () => {
  it('maps tool calls and results', () => {
    const out = toOpenAiMessages(conversation);
    expect(out[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'get_contact', arguments: '{"contactId":1}' } },
        { id: 'b' },
      ],
    });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'b', content: 'not found' });
  });
});

describe('Gemini mapping', () => {
  it('maps function calls and groups function responses', () => {
    const out = toGeminiContents(conversation, 'gemini-2.5-flash');
    expect(out.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(out[2]!.parts).toEqual([
      { functionResponse: { id: 'a', name: 'get_contact', response: { output: '{"id":1}' } } },
      { functionResponse: { id: 'b', name: 'get_contact', response: { error: 'not found' } } },
    ]);
  });
});

describe('tool definitions', () => {
  it('are generated from the shared zod contracts', () => {
    const [def] = toolDefinitions(['add_note', 'not_a_tool']);
    expect(def!.name).toBe('add_note');
    expect(def!.inputSchema).toMatchObject({
      type: 'object',
      required: ['contactId', 'body'],
      additionalProperties: false,
    });
    expect(def!.inputSchema).not.toHaveProperty('$schema');
  });
});

describe('costUsd', () => {
  it('prices per million tokens', () => {
    const m = { inputUsdPerMTok: 2, outputUsdPerMTok: 10 } as ModelSpec;
    expect(costUsd(m, 1_000_000, 100_000)).toBe(3);
    expect(costUsd(m, 712, 20)).toBe(0.001624);
  });
});

describe('sanitizeOutput', () => {
  it('removes leaked tool-call markup and internal tags', () => {
    expect(sanitizeOutput('Hi <thinking>secret</thinking>there')).toBe('Hi there');
    expect(sanitizeOutput('Done\n<function_calls><invoke name="x"></invoke></function_calls>')).toBe('Done');
    expect(sanitizeOutput('Saved.\n{"name": "add_note", "arguments": {"contactId": 1}}')).toBe('Saved.');
    expect(sanitizeOutput('Plain answer with {braces} is fine')).toBe('Plain answer with {braces} is fine');
  });
});

describe('MockProvider', () => {
  const model: ModelSpec = {
    id: 'mock:x',
    provider: 'mock',
    modelName: 'x',
    tier: 'standard',
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 1,
    params: {},
  };
  const tools = toolDefinitions(['search_contacts', 'get_contact', 'add_note']);

  it('is deterministic', async () => {
    const p = new MockProvider();
    const req = {
      model,
      system: 'sys',
      messages: [{ role: 'user' as const, content: 'find Maya' }],
      tools,
      maxTokens: 100,
    };
    expect(await p.chat(req)).toEqual(await p.chat(req));
  });

  it('extracts note text', async () => {
    const p = new MockProvider();
    const res = await p.chat({
      model,
      system: 'Context: {"contactId":1}',
      messages: [{ role: 'user', content: 'Add a note: renewal call booked' }],
      tools: toolDefinitions(['add_note']),
      maxTokens: 100,
    });
    expect(res.toolCalls[0]).toMatchObject({
      name: 'add_note',
      args: { contactId: 1, body: 'Renewal call booked' },
    });
  });
});

describe('assertProductionSafe', () => {
  it('rejects dev secrets in production only', async () => {
    const { assertProductionSafe, loadConfig } = await import('../src/config.js');
    expect(() => assertProductionSafe(loadConfig({ NODE_ENV: 'production' }))).toThrow(/CRM_TOOL_TOKEN/);
    expect(() => assertProductionSafe(loadConfig({ NODE_ENV: 'development' }))).not.toThrow();
    expect(() =>
      assertProductionSafe(
        loadConfig({
          NODE_ENV: 'production',
          CRM_TOOL_TOKEN: 'x'.repeat(32),
          SEED_SALES_API_KEY: 'a'.repeat(32),
          SEED_ADMIN_API_KEY: 'b'.repeat(32),
        }),
      ),
    ).not.toThrow();
  });
});
