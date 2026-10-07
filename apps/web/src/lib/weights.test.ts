import { describe, expect, it } from 'vitest';
import { checkWeights, compactWeights, describeDeployment, pinVersion } from './weights';

describe('checkWeights', () => {
  it('accepts weights that sum to 100', () => {
    expect(
      checkWeights([
        { version: 1, weight: 50 },
        { version: 2, weight: 50 },
      ]).ok,
    ).toBe(true);
  });
  it('rejects totals other than 100', () => {
    const r = checkWeights([
      { version: 1, weight: 60 },
      { version: 2, weight: 30 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.total).toBe(90);
  });
  it('rejects duplicates, fractions and empty lists', () => {
    expect(checkWeights([]).ok).toBe(false);
    expect(
      checkWeights([
        { version: 1, weight: 50 },
        { version: 1, weight: 50 },
      ]).ok,
    ).toBe(false);
    expect(
      checkWeights([
        { version: 1, weight: 99.5 },
        { version: 2, weight: 0.5 },
      ]).ok,
    ).toBe(false);
  });
});

describe('deployment helpers', () => {
  it('pins a version for rollback', () => {
    expect(pinVersion(1)).toEqual([{ version: 1, weight: 100 }]);
  });
  it('compacts and describes', () => {
    const w = [
      { version: 2, weight: 50 },
      { version: 3, weight: 0 },
      { version: 1, weight: 50 },
    ];
    expect(compactWeights(w)).toEqual([
      { version: 1, weight: 50 },
      { version: 2, weight: 50 },
    ]);
    expect(describeDeployment(w)).toBe('v1 50% · v2 50%');
    expect(describeDeployment(pinVersion(4))).toBe('v4 gets all traffic');
  });
});
