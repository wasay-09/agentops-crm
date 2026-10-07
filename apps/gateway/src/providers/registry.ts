import type { Config } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { MockProvider } from './mock.js';
import { OpenAiProvider } from './openai.js';
import type { LlmProvider } from './types.js';

export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(providers: LlmProvider[]) {
    for (const p of providers) this.providers.set(p.name, p);
  }

  static fromConfig(config: Config): ProviderRegistry {
    return new ProviderRegistry([
      new AnthropicProvider(config.ANTHROPIC_API_KEY, config.LLM_TIMEOUT_MS),
      new OpenAiProvider(config.OPENAI_API_KEY, config.LLM_TIMEOUT_MS),
      new GeminiProvider(config.GEMINI_API_KEY, config.LLM_TIMEOUT_MS),
      new MockProvider(config.MOCK_LATENCY_MS),
    ]);
  }

  get(name: string): LlmProvider | undefined {
    return this.providers.get(name);
  }

  isAvailable(name: string): boolean {
    return this.providers.get(name)?.isConfigured() ?? false;
  }
}
