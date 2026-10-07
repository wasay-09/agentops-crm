import type { DeploymentWeight, Prompt } from '@agentops/contracts';
import { asc, eq, max } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { promptDeployments, prompts, promptVersions } from '../db/schema.js';
import { fnv1a } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { KNOWN_VARIABLES, templateVariables } from './render.js';

export interface ResolvedPrompt {
  name: string;
  versionId: string;
  version: number;
  template: string;
}

/**
 * Pick a version from deployment weights. `stickyKey` (idempotency key or run id) is hashed into a
 * 0–99 bucket, so the same request always gets the same version — retries can't flip an A/B arm.
 */
export function pickVersion(weights: DeploymentWeight[], stickyKey: string): number {
  const active = weights.filter((w) => w.weight > 0);
  if (active.length === 0) throw new Error('deployment has no active versions');
  const bucket = fnv1a(stickyKey) % 100;
  let cumulative = 0;
  for (const w of active) {
    cumulative += w.weight;
    if (bucket < cumulative) return w.version;
  }
  return active[active.length - 1]!.version;
}

export class PromptRegistry {
  constructor(private readonly db: Db) {}

  async resolve(name: string, stickyKey: string): Promise<ResolvedPrompt> {
    const [prompt] = await this.db.select().from(prompts).where(eq(prompts.name, name));
    if (!prompt) throw notFound(`Prompt "${name}"`);
    const [deployment] = await this.db
      .select()
      .from(promptDeployments)
      .where(eq(promptDeployments.promptId, prompt.id));
    if (!deployment) throw notFound(`Deployment for prompt "${name}"`);
    const version = pickVersion(deployment.weights, stickyKey);
    const versions = await this.db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, prompt.id));
    const chosen = versions.find((v) => v.version === version);
    if (!chosen) throw notFound(`Prompt "${name}" v${version}`);
    return { name, versionId: chosen.id, version: chosen.version, template: chosen.template };
  }

  async list(): Promise<Prompt[]> {
    const rows = await this.db.select().from(prompts).orderBy(asc(prompts.name));
    return Promise.all(rows.map((r) => this.get(r.name)));
  }

  async get(name: string): Promise<Prompt> {
    const [prompt] = await this.db.select().from(prompts).where(eq(prompts.name, name));
    if (!prompt) throw notFound(`Prompt "${name}"`);
    const [versions, [deployment]] = await Promise.all([
      this.db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.promptId, prompt.id))
        .orderBy(asc(promptVersions.version)),
      this.db.select().from(promptDeployments).where(eq(promptDeployments.promptId, prompt.id)),
    ]);
    return {
      name: prompt.name,
      description: prompt.description,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        template: v.template,
        notes: v.notes,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
      })),
      deployment: deployment?.weights ?? [],
      deploymentUpdatedAt: deployment?.updatedAt.toISOString() ?? null,
      deploymentUpdatedBy: deployment?.updatedBy ?? null,
    };
  }

  /** Versions are immutable; a change is always a new version. New versions get 0% traffic until deployed. */
  async createVersion(name: string, template: string, notes?: string, createdBy?: string): Promise<Prompt> {
    const unknown = templateVariables(template).filter(
      (v) => !(KNOWN_VARIABLES as readonly string[]).includes(v),
    );
    if (unknown.length > 0)
      throw badRequest(
        `Unknown template variables: ${unknown.join(', ')}. Allowed: ${KNOWN_VARIABLES.join(', ')}`,
      );
    await this.db.transaction(async (tx) => {
      const [prompt] = await tx.select().from(prompts).where(eq(prompts.name, name)).for('update');
      if (!prompt) throw notFound(`Prompt "${name}"`);
      const [{ latest } = { latest: 0 }] = await tx
        .select({ latest: max(promptVersions.version) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, prompt.id));
      await tx.insert(promptVersions).values({
        promptId: prompt.id,
        version: (latest ?? 0) + 1,
        template,
        notes: notes ?? null,
        createdBy: createdBy ?? null,
      });
    });
    return this.get(name);
  }

  /** A/B split or rollback: weights must reference existing versions and sum to 100. */
  async setDeployment(name: string, weights: DeploymentWeight[], updatedBy?: string): Promise<Prompt> {
    const current = await this.get(name);
    const existing = new Set(current.versions.map((v) => v.version));
    const missing = weights.filter((w) => !existing.has(w.version)).map((w) => w.version);
    if (missing.length > 0) throw badRequest(`Unknown versions: ${missing.join(', ')}`);
    if (weights.reduce((s, w) => s + w.weight, 0) !== 100) throw badRequest('Weights must sum to 100');
    const [prompt] = await this.db.select().from(prompts).where(eq(prompts.name, name));
    await this.db
      .insert(promptDeployments)
      .values({ promptId: prompt!.id, weights, updatedBy: updatedBy ?? null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: promptDeployments.promptId,
        set: { weights, updatedBy: updatedBy ?? null, updatedAt: new Date() },
      });
    return this.get(name);
  }
}
