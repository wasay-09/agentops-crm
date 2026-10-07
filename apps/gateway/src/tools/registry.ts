import { isToolName, TOOL_CONTRACTS, TOOL_HEADERS, type ToolName, ToolResponse } from '@agentops/contracts';
import { z } from 'zod';
import type { ToolDefinition } from '../providers/types.js';
import { traceHeaders } from '../telemetry.js';

export interface ToolContext {
  runId: string;
  teamName: string;
  /** Who approved a write (recorded by the CRM as the note author). */
  actor?: string;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; code: string; message: string };

/** Executes tools against a system of record. The HTTP executor talks to the CRM; tests/evals use a fixture. */
export interface ToolExecutor {
  execute(name: ToolName, args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/** JSON Schema tool definitions derived from the shared zod contracts (one source of truth). */
export function toolDefinitions(names: string[]): ToolDefinition[] {
  return names.filter(isToolName).map((name) => {
    const contract = TOOL_CONTRACTS[name];
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(contract.args) as Record<string, unknown>;
    return { name, description: contract.description, inputSchema };
  });
}

export class HttpToolExecutor implements ToolExecutor {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async execute(name: ToolName, args: unknown, ctx: ToolContext): Promise<ToolResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/tools/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          [TOOL_HEADERS.runId]: ctx.runId,
          [TOOL_HEADERS.team]: ctx.teamName,
          ...(ctx.actor && { [TOOL_HEADERS.actor]: ctx.actor }),
          ...traceHeaders(),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      return {
        ok: false,
        code: timedOut ? 'tool_timeout' : 'crm_unreachable',
        message: 'The CRM could not be reached',
      };
    }
    const body = ToolResponse.safeParse(await res.json().catch(() => null));
    if (!body.success)
      return {
        ok: false,
        code: 'bad_tool_response',
        message: `CRM returned an unexpected response (${res.status})`,
      };
    if (!body.data.ok) return { ok: false, code: body.data.error.code, message: body.data.error.message };
    return { ok: true, data: body.data.data };
  }
}
