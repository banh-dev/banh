import { expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../packages/cli/src/run.js';
import { fakeBackend } from './fake-backend.js';
import { supportYaml } from './helpers.js';

const workflow = 'examples/support-triage.yaml';
const input = 'examples/inputs/support-ticket.json';

it('emits JSON only on stdout and events on stderr, and closes the backend', async () => {
  const backend = fakeBackend();
  const stdout = vi.fn();
  const stderr = vi.fn();
  const createBackend = vi.fn().mockResolvedValue(backend);
  await runCommand([workflow, '--input', input, '--json', '--verbose', '--model-dir', '/model'], { createBackend, stdout, stderr });
  expect(stdout).toHaveBeenCalledTimes(1);
  expect(JSON.parse(stdout.mock.calls[0]![0])).toMatchObject({ process: 'support_triage', output: { route: 'billing' } });
  expect(stderr).toHaveBeenCalledTimes(4);
  expect(createBackend).toHaveBeenCalledWith({ modelDir: '/model' });
  expect(backend.closed).toBe(true);
});

it('prints readable results by default', async () => {
  const stdout = vi.fn();
  await runCommand([workflow, '--input', input], { createBackend: async () => fakeBackend(), stdout });
  expect(stdout.mock.calls[0]![0]).toContain('Process: support_triage');
  expect(stdout.mock.calls[0]![0]).toContain('Tokens:    42');
});

it('validates arguments and input before creating a model', async () => {
  const createBackend = vi.fn();
  for (const args of [[workflow], [workflow, '--text', 'abc', '--input', input], [workflow, '--input', input, '--bad'], [workflow, '--text', 'abc'], [workflow, '--input', workflow]]) {
    await expect(runCommand(args, { createBackend })).rejects.toThrow();
  }
  expect(createBackend).not.toHaveBeenCalled();
});

it('closes after failure and preserves the inference error if cleanup also fails', async () => {
  const backend = fakeBackend();
  vi.spyOn(backend, 'evaluate').mockRejectedValue(new Error('inference failed'));
  const close = vi.spyOn(backend, 'close').mockRejectedValue(new Error('close failed'));
  const stdout = vi.fn();
  const stderr = vi.fn();
  await expect(runCommand([workflow, '--input', input], { createBackend: async () => backend, stdout, stderr })).rejects.toThrow('inference failed');
  expect(close).toHaveBeenCalledOnce();
  expect(stdout).not.toHaveBeenCalled();
  expect(stderr).toHaveBeenCalledWith('Cleanup failed: close failed');
});

it('supports text supplied directly or through a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'banh-'));
  try {
    const path = join(dir, 'text.yaml');
    const input = join(dir, 'text.txt');
    await writeFile(path, supportYaml.replace('type: json', 'type: text'));
    await writeFile(input, 'raw ticket text');
    const backend = fakeBackend();
    for (const args of [[path, '--text', 'raw ticket text'], [path, '--input', input]]) {
      await runCommand(args, { createBackend: async () => backend, stdout: vi.fn() });
    }
    expect(backend.calls.map(call => call.state)).toEqual(['raw ticket text', 'raw ticket text']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
