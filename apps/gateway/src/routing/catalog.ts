import type { AgentConfig, RoutingPolicy, TaskType } from '@agentops/contracts';
import type { Db } from '../db/client.js';
import { agents, models, routingPolicies } from '../db/schema.js';
import type { ModelSpec } from '../providers/types.js';

interface Snapshot {
  models: Map<string, ModelSpec & { enabled: boolean }>;
  policies: Map<string, RoutingPolicy>;
  agents: Map<string, AgentConfig>;
  loadedAt: number;
}

/**
 * Read-mostly configuration (models, routing policies, agents) cached in memory with a short TTL.
 * Admin writes call `invalidate()` so changes apply immediately on this instance and within `ttlMs` elsewhere.
 */
export class Catalog {
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;

  constructor(
    private readonly db: Db,
    private readonly ttlMs = 10_000,
  ) {}

  invalidate(): void {
    this.snapshot = null;
  }

  async model(id: string) {
    return (await this.get()).models.get(id);
  }

  async allModels() {
    return [...(await this.get()).models.values()];
  }

  async policy(taskType: TaskType | string) {
    return (await this.get()).policies.get(taskType);
  }

  async allPolicies() {
    return [...(await this.get()).policies.values()];
  }

  async agent(slug: string) {
    return (await this.get()).agents.get(slug);
  }

  async allAgents() {
    return [...(await this.get()).agents.values()];
  }

  async agentEnabled(slug: string): Promise<AgentConfig | undefined> {
    const a = await this.agent(slug);
    return a?.enabled ? a : undefined;
  }

  private async get(): Promise<Snapshot> {
    if (this.snapshot && Date.now() - this.snapshot.loadedAt < this.ttlMs) return this.snapshot;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    this.snapshot = await this.loading;
    return this.snapshot;
  }

  private async load(): Promise<Snapshot> {
    const [modelRows, policyRows, agentRows] = await Promise.all([
      this.db.select().from(models),
      this.db.select().from(routingPolicies),
      this.db.select().from(agents),
    ]);
    return {
      models: new Map(modelRows.map((m) => [m.id, { ...m }])),
      policies: new Map(
        policyRows.map((p) => [
          p.taskType,
          {
            taskType: p.taskType as TaskType,
            chain: p.chain,
            budgetModel: p.budgetModel,
            maxOutputTokens: p.maxOutputTokens,
            updatedAt: p.updatedAt.toISOString(),
          },
        ]),
      ),
      agents: new Map(
        agentRows.map((a) => [
          a.slug,
          {
            slug: a.slug,
            name: a.name,
            description: a.description,
            taskType: a.taskType as TaskType,
            promptName: a.promptName,
            tools: a.tools,
            maxSteps: a.maxSteps,
            enabled: a.enabled,
          },
        ]),
      ),
      loadedAt: Date.now(),
    };
  }
}
