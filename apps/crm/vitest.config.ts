import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so Nest's decorator metadata is emitted in tests.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.CRM_TEST_DATABASE_URL ?? 'postgres://localhost:5432/agentops_crm_test',
      JWT_SECRET: 'test-jwt-secret',
      CRM_TOOL_TOKEN: 'test-tool-token',
      GATEWAY_URL: 'http://127.0.0.1:9',
      GATEWAY_API_KEY: 'ak_test_team',
      GATEWAY_ADMIN_KEY: 'ak_test_admin',
    },
  },
});
