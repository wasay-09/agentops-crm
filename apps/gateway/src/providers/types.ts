import type { ModelParams } from '../db/schema.js';

/**
 * Provider-neutral chat types. Agents, the router and the ledger only see these;
 * each adapter maps them to and from its SDK.
 */

export interface ToolCallRequest {
  /** Provider-issued id (or generated) used to pair the call with its result. */
  id: string;
  name: string;
  args: unknown;
}

/** The provider's own assistant turn, replayed verbatim when the same model continues (keeps thinking blocks valid). */
export interface NativeTurn {
  provider: string;
  model: string;
  content: unknown;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCallRequest[]; native?: NativeTurn }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelSpec {
  id: string;
  provider: string;
  modelName: string;
  tier: 'cheap' | 'standard' | 'premium';
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  params: ModelParams;
}

export interface ChatRequest {
  model: ModelSpec;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface ChatResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  stopReason: StopReason;
  usage: { inputTokens: number; outputTokens: number };
  native?: NativeTurn;
}

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/** Normalized provider failure. `retryable` drives same-model retry and fallback. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function costUsd(
  model: Pick<ModelSpec, 'inputUsdPerMTok' | 'outputUsdPerMTok'>,
  inputTokens: number,
  outputTokens: number,
): number {
  const cost = (inputTokens * model.inputUsdPerMTok + outputTokens * model.outputUsdPerMTok) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

/** Rough token estimate (~4 chars/token) used for budget reservations, not billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateRequestTokens(req: Pick<ChatRequest, 'system' | 'messages' | 'tools'>): number {
  return (
    estimateTokens(req.system) +
    estimateTokens(JSON.stringify(req.messages)) +
    estimateTokens(JSON.stringify(req.tools))
  );
}
