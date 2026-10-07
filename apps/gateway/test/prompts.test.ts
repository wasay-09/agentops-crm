import { afterEach, describe, expect, it } from 'vitest';
import { pickVersion } from '../src/prompts/registry.js';
import { PromptRenderError, renderTemplate } from '../src/prompts/render.js';
import { ADMIN_KEY, auth, createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
afterEach(async () => ctx?.close());

describe('pickVersion', () => {
  it('is sticky for the same key and roughly follows the weights', () => {
    const weights = [
      { version: 1, weight: 70 },
      { version: 2, weight: 30 },
    ];
    expect(pickVersion(weights, 'run-123')).toBe(pickVersion(weights, 'run-123'));
    const counts = { 1: 0, 2: 0 } as Record<number, number>;
    for (let i = 0; i < 5000; i++) counts[pickVersion(weights, `key-${i}`)]! += 1;
    expect(counts[1]! / 5000).toBeGreaterThan(0.65);
    expect(counts[1]! / 5000).toBeLessThan(0.75);
  });

  it('ignores zero-weight versions', () => {
    expect(
      pickVersion(
        [
          { version: 1, weight: 0 },
          { version: 2, weight: 100 },
        ],
        'x',
      ),
    ).toBe(2);
  });
});

describe('renderTemplate', () => {
  it('substitutes strings and JSON-encodes objects', () => {
    expect(renderTemplate('Hi {{ name }}, ctx={{context}}', { name: 'Ada', context: { contactId: 1 } })).toBe(
      'Hi Ada, ctx={"contactId":1}',
    );
  });
  it('fails fast on missing variables', () => {
    expect(() => renderTemplate('{{today}} {{missing}}', { today: 'x' })).toThrow(PromptRenderError);
  });
});

describe('prompt registry API', () => {
  it('creates immutable versions, deploys them, and rolls back', async () => {
    ctx = await createTestContext();
    const admin = auth(ADMIN_KEY);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/prompts/lead-summarizer/versions',
      headers: admin,
      payload: { template: 'Brief for {{context}} on {{today}}', notes: 'shorter', createdBy: 'ada' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().prompt.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    // New versions get no traffic until deployed.
    expect(created.json().prompt.deployment).toEqual([{ version: 1, weight: 100 }]);

    const deploy = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/prompts/lead-summarizer/deployment',
      headers: admin,
      payload: { weights: [{ version: 2, weight: 100 }], updatedBy: 'ada' },
    });
    expect(deploy.json().prompt).toMatchObject({
      deployment: [{ version: 2, weight: 100 }],
      deploymentUpdatedBy: 'ada',
    });
    expect((await ctx.services.prompts.resolve('lead-summarizer', 'any')).version).toBe(2);

    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/prompts/lead-summarizer/deployment',
      headers: admin,
      payload: { weights: [{ version: 1, weight: 100 }] },
    });
    expect((await ctx.services.prompts.resolve('lead-summarizer', 'any')).version).toBe(1);
  });

  it('rejects unknown variables, unknown versions and weights that do not sum to 100', async () => {
    ctx = await createTestContext();
    const admin = auth(ADMIN_KEY);
    const badVar = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/prompts/lead-summarizer/versions',
      headers: admin,
      payload: { template: 'Hi {{user_email}}' },
    });
    expect(badVar.statusCode).toBe(400);
    const badVersion = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/prompts/lead-summarizer/deployment',
      headers: admin,
      payload: { weights: [{ version: 9, weight: 100 }] },
    });
    expect(badVersion.statusCode).toBe(400);
    const badSum = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/prompts/crm-assistant/deployment',
      headers: admin,
      payload: {
        weights: [
          { version: 1, weight: 60 },
          { version: 2, weight: 30 },
        ],
      },
    });
    expect(badSum.statusCode).toBe(400);
  });

  it('requires the admin scope', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/admin/prompts', headers: auth() });
    expect(res.statusCode).toBe(403);
  });
});
