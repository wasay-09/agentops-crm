import type { DeploymentWeight } from '@agentops/contracts';

export interface WeightCheck {
  ok: boolean;
  total: number;
  message: string | null;
}

/** Mirrors the gateway rule: at least one version, integer weights 0-100, summing to exactly 100. */
export function checkWeights(weights: DeploymentWeight[]): WeightCheck {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (weights.length === 0) return { ok: false, total, message: 'Add at least one version.' };
  if (weights.some((w) => !Number.isInteger(w.weight) || w.weight < 0 || w.weight > 100)) {
    return { ok: false, total, message: 'Each weight must be a whole number from 0 to 100.' };
  }
  const versions = new Set(weights.map((w) => w.version));
  if (versions.size !== weights.length) return { ok: false, total, message: 'Each version can appear once.' };
  if (total !== 100)
    return { ok: false, total, message: `Weights add up to ${total}. They must add up to 100.` };
  return { ok: true, total, message: null };
}

/** Deployment that sends all traffic to one version: a rollback, or a full rollout. */
export function pinVersion(version: number): DeploymentWeight[] {
  return [{ version, weight: 100 }];
}

/** Drops zero-weight rows so the saved deployment only lists live versions. */
export function compactWeights(weights: DeploymentWeight[]): DeploymentWeight[] {
  return weights.filter((w) => w.weight > 0).sort((a, b) => a.version - b.version);
}

export function describeDeployment(weights: DeploymentWeight[]): string {
  const live = compactWeights(weights);
  if (live.length === 0) return 'Not deployed';
  if (live.length === 1) return `v${live[0]!.version} gets all traffic`;
  return live.map((w) => `v${w.version} ${w.weight}%`).join(' · ');
}
