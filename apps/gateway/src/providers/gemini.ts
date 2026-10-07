import { randomUUID } from 'node:crypto';
import { ApiError, type Content, GoogleGenAI, type Part } from '@google/genai';
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  isRetryableStatus,
  type LlmProvider,
  ProviderError,
  type ToolCallRequest,
} from './types.js';

/** Gemini via generateContent with function declarations. */
export class GeminiProvider implements LlmProvider {
  readonly name = 'google';
  private readonly client: GoogleGenAI | null;

  constructor(
    apiKey: string | undefined,
    private readonly timeoutMs: number,
  ) {
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.client) throw new ProviderError('Gemini is not configured', 'not_configured', false);
    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
    try {
      response = await this.client.models.generateContent({
        model: req.model.modelName,
        contents: toGeminiContents(req.messages, req.model.modelName),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens,
          abortSignal: req.signal,
          httpOptions: { timeout: this.timeoutMs },
          ...(req.tools.length > 0 && {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.inputSchema,
                })),
              },
            ],
          }),
        },
      });
    } catch (err) {
      throw normalizeGeminiError(err);
    }

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const toolCalls: ToolCallRequest[] = (response.functionCalls ?? []).map((fc) => ({
      id: fc.id ?? `call_${randomUUID()}`,
      name: fc.name ?? 'unknown',
      args: fc.args ?? {},
    }));
    const text = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('')
      .trim();
    const finish = candidate?.finishReason;
    return {
      text,
      toolCalls,
      stopReason:
        finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT'
          ? 'refusal'
          : finish === 'MAX_TOKENS'
            ? 'max_tokens'
            : toolCalls.length > 0
              ? 'tool_use'
              : 'end',
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens:
          (response.usageMetadata?.candidatesTokenCount ?? 0) +
          (response.usageMetadata?.thoughtsTokenCount ?? 0),
      },
      // Replaying the model's own parts keeps thought signatures intact for multi-turn function calling.
      native: { provider: 'google', model: req.model.modelName, content: parts },
    };
  }
}

export function toGeminiContents(messages: ChatMessage[], modelName: string): Content[] {
  const out: Content[] = [];
  let pending: Part[] = [];
  const flush = () => {
    if (pending.length > 0) {
      out.push({ role: 'user', parts: pending });
      pending = [];
    }
  };
  for (const m of messages) {
    if (m.role === 'tool') {
      pending.push({
        functionResponse: {
          id: m.toolCallId,
          name: m.name,
          response: m.isError ? { error: m.content } : { output: m.content },
        },
      });
      continue;
    }
    flush();
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.native?.provider === 'google' && m.native.model === modelName) {
      out.push({ role: 'model', parts: m.native.content as Part[] });
    } else {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls) {
        parts.push({
          functionCall: { id: tc.id, name: tc.name, args: (tc.args ?? {}) as Record<string, unknown> },
        });
      }
      out.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '(no content)' }] });
    }
  }
  flush();
  return out;
}

function normalizeGeminiError(err: unknown): ProviderError {
  if (err instanceof ApiError) {
    const code =
      err.status === 429 ? 'rate_limited' : err.status >= 500 ? 'provider_unavailable' : `http_${err.status}`;
    return new ProviderError(err.message, code, isRetryableStatus(err.status), err.status);
  }
  if (err instanceof Error && /timeout|abort/i.test(err.message))
    return new ProviderError('Gemini request timed out', 'timeout', true);
  return new ProviderError(err instanceof Error ? err.message : String(err), 'connection_error', true);
}
