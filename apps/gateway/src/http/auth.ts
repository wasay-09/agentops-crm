import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { apiKeys, teams } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export interface AuthContext {
  keyId: string;
  teamId: string;
  teamName: string;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

const CACHE_TTL_MS = 30_000;

/** Bearer API keys, stored as SHA-256 hashes. Lookups are cached briefly; revocation applies within the TTL. */
export class ApiKeyAuth {
  private readonly cache = new Map<string, { ctx: AuthContext | null; at: number }>();

  constructor(private readonly db: Db) {}

  async authenticate(header: string | undefined): Promise<AuthContext> {
    const key = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!key) throw new AppError(401, 'unauthorized', 'Missing API key');
    const hash = sha256(key);
    const cached = this.cache.get(hash);
    let ctx = cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.ctx : undefined;
    if (ctx === undefined) {
      const [row] = await this.db
        .select({ keyId: apiKeys.id, teamId: teams.id, teamName: teams.name, scopes: apiKeys.scopes })
        .from(apiKeys)
        .innerJoin(teams, eq(teams.id, apiKeys.teamId))
        .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));
      ctx = row ?? null;
      this.cache.set(hash, { ctx, at: Date.now() });
    }
    if (!ctx) throw new AppError(401, 'unauthorized', 'Invalid API key');
    return ctx;
  }

  clear(): void {
    this.cache.clear();
  }
}

export function requireScope(scope: 'runs' | 'admin') {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.auth.scopes.includes(scope))
      throw new AppError(403, 'forbidden', `API key lacks the "${scope}" scope`);
  };
}
