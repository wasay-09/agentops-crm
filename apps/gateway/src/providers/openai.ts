import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  isRetryableStatus,
  type LlmProvider,
  ProviderError,
  type ToolCallRequest,
} from './types.js';

/** OpenAI Chat Completions with function calling. */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly client: OpenAI | null;

  constructor(apiKey: string | undefined, timeoutMs: number) {
    this.client = apiKey ? new OpenAI({ apiKey, maxRetries: 0, timeout: timeoutMs }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.client) throw new ProviderError('OpenAI is not configured', 'not_configured', false);
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: req.model.modelName,
          max_completion_tokens: req.maxTokens,
          messages: [{ role: 'system', content: req.system }, ...toOpenAiMessages(req.messages)],
          ...(req.tools.length > 0 && {
            tools: req.tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }),
        },
        { signal: req.signal },
      );
    } catch (err) {
      throw normalizeOpenAiError(err);
    }

    const choice = completion.choices[0];
    if (!choice) throw new ProviderError('OpenAI returned no choices', 'empty_response', true);
    const toolCalls: ToolCallRequest[] = [];
    for (const tc of choice.message.tool_calls ?? []) {
      if (tc.type !== 'function') continue;
      toolCalls.push({ id: tc.id, name: tc.function.name, args: safeJson(tc.function.arguments) });
    }
    const refused = Boolean(choice.message.refusal);
    return {
      text: (choice.message.content ?? choice.message.refusal ?? '').trim(),
      toolCalls,
      stopReason: refused
        ? 'refusal'
        : choice.finish_reason === 'length'
          ? 'max_tokens'
          : toolCalls.length > 0
            ? 'tool_use'
            : 'end',
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }
}

export function toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    return {
      role: 'assistant',
      content: m.content || null,
      ...(m.toolCalls.length > 0 && {
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        })),
      }),
    };
  });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Let the agent runtime's schema validation report it back to the model.
    return { __invalid_json: raw };
  }
}

function normalizeOpenAiError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIConnectionTimeoutError)
    return new ProviderError('OpenAI request timed out', 'timeout', true);
  if (err instanceof OpenAI.APIConnectionError)
    return new ProviderError('OpenAI connection failed', 'connection_error', true);
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    const code =
      status === 429 ? 'rate_limited' : status && status >= 500 ? 'provider_unavailable' : `http_${status}`;
    return new ProviderError(err.message, code, isRetryableStatus(status), status);
  }
  return new ProviderError(err instanceof Error ? err.message : String(err), 'unknown', false);
}
