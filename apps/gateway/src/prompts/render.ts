export class PromptRenderError extends Error {
  constructor(readonly missing: string[]) {
    super(`Prompt template is missing variables: ${missing.join(', ')}`);
    this.name = 'PromptRenderError';
  }
}

const VAR = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR)].map((m) => m[1]!))];
}

/** `{{name}}` substitution. Objects are rendered as JSON. Missing variables fail fast rather than shipping a broken prompt. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  const missing = templateVariables(template).filter((v) => vars[v] === undefined);
  if (missing.length > 0) throw new PromptRenderError(missing);
  return template.replace(VAR, (_, name: string) => {
    const value = vars[name];
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/** Variables every agent prompt may use. Validated when a new version is created. */
export const KNOWN_VARIABLES = ['today', 'context', 'agent_name'] as const;
