import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
  BetaMessageParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  isRetryableStatus,
  type LlmProvider,
  ProviderError,
  type StopReason,
  type ToolCallRequest,
} from './types.js';

/**
 * Claude via the Messages API. Uses the beta namespace so models configured with
 * `refusalFallback` can opt into server-side refusal fallback; the request shape is otherwise standard.
 * SDK retries are off — the gateway's router owns retry and fallback.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic | null;

  constructor(apiKey: string | undefined, timeoutMs: number) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.client) throw new ProviderError('Anthropic is not configured', 'not_configured', false);
    const params: BetaMessageCreateParamsNonStreaming = {
      model: req.model.modelName,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: toAnthropicMessages(req.messages, req.model.modelName),
      ...(req.tools.length > 0 && {
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as BetaToolInputSchema,
        })),
      }),
      ...(req.model.params.effort && { output_config: { effort: req.model.params.effort } }),
      ...(req.model.params.refusalFallback && {
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default' as const,
      }),
    };

    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create(params, { signal: req.signal });
    } catch (err) {
      throw normalizeAnthropicError(err);
    }

    const toolCalls: ToolCallRequest[] = [];
    const text: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') text.push(block.text);
      else if (block.type === 'tool_use')
        toolCalls.push({ id: block.id, name: block.name, args: block.input });
    }

    return {
      text: text.join('\n').trim(),
      toolCalls,
      stopReason: mapStopReason(response.stop_reason, toolCalls.length),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      native: {
        provider: 'anthropic',
        model: req.model.modelName,
        content: response.content satisfies BetaContentBlock[],
      },
    };
  }
}

type BetaToolInputSchema = Anthropic.Beta.Messages.BetaTool.InputSchema;

function mapStopReason(reason: string | null, toolCalls: number): StopReason {
  if (reason === 'refusal') return 'refusal';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens';
  if (reason === 'tool_use' || toolCalls > 0) return 'tool_use';
  return 'end';
}

/**
 * Normalized messages → Anthropic messages.
 * - Consecutive tool results are grouped into one user turn (parallel tool calls must be answered together).
 * - An assistant turn produced by this same model is replayed verbatim, so thinking blocks stay valid.
 */
export function toAnthropicMessages(messages: ChatMessage[], modelName: string): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  let pendingResults: BetaToolResultBlockParam[] = [];

  const flushResults = () => {
    if (pendingResults.length > 0) {
      out.push({ role: 'user', content: pendingResults });
      pendingResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        is_error: m.isError ?? false,
      });
      continue;
    }
    flushResults();
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.native?.provider === 'anthropic' && m.native.model === modelName) {
      out.push({ role: 'assistant', content: m.native.content as BetaContentBlockParam[] });
    } else {
      const blocks: BetaContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls)
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
      out.push({
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: '(no content)' }],
      });
    }
  }
  flushResults();
  return out;
}

function normalizeAnthropicError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError('Anthropic request timed out', 'timeout', true);
  if (err instanceof Anthropic.APIConnectionError)
    return new ProviderError('Anthropic connection failed', 'connection_error', true);
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    const code =
      status === 429 ? 'rate_limited' : status && status >= 500 ? 'provider_unavailable' : `http_${status}`;
    return new ProviderError(err.message, code, isRetryableStatus(status), status);
  }
  return new ProviderError(err instanceof Error ? err.message : String(err), 'unknown', false);
}
