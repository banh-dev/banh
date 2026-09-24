import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { makeProcess } from './helpers.js';
import { ProcessRuntime } from '@banh/runtime';

it.skipIf(process.env.LAYA_INTEGRATION !== '1')('executes the support workflow with real Laya', async () => {
  const { LayaBackend } = await import('@banh/laya');
  const backend = await LayaBackend.create(process.env.LAYA_MODEL_DIR ? { modelDir: process.env.LAYA_MODEL_DIR } : {});
  try {
    const input: unknown = JSON.parse(await readFile('examples/inputs/support-ticket.json', 'utf8'));
    const result = await new ProcessRuntime(backend).execute(makeProcess(), input);
    expect(Object.keys(result.decisions)).toEqual(['department', 'urgent', 'severity']);
    expect(['escalation', 'billing', 'sales', 'support']).toContain((result.output as { route: string }).route);
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
  } finally { await backend.close(); }
}, 600_000);
