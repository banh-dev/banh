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
  expect(createBackend).toHaveBeenCalledWith({ provider: 'native', model: 'laya', options: { modelDir: '/model' } });
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

it('selects HTTP using flags over environment and keeps cloud credentials separate', async () => {
  const createBackend = vi.fn().mockResolvedValue(fakeBackend());
  await runCommand([workflow, '--input', input, '--provider', 'http', '--base-url', 'http://localhost:8000', '--timeout-ms', '1200'], {
    createBackend, stdout: vi.fn(),
    env: { BANH_PROVIDER: 'native', BANH_INFERENCE_BASE_URL: 'http://unused', BANH_INFERENCE_TOKEN: 'inference-secret', BANH_INFERENCE_TIMEOUT_MS: '999', BANH_API_TOKEN: 'cloud-secret' },
  });
  expect(createBackend).toHaveBeenCalledWith({ provider: 'http', model: 'laya', options: {
    baseUrl: 'http://localhost:8000', token: 'inference-secret', timeoutMs: 1200,
  } });
});

it('supports environment-only HTTP configuration without authentication', async () => {
  const createBackend = vi.fn().mockResolvedValue(fakeBackend());
  await runCommand([workflow, '--input', input], { createBackend, stdout: vi.fn(), env: {
    BANH_PROVIDER: 'http', BANH_MODEL: 'laya', BANH_INFERENCE_BASE_URL: 'http://localhost:8000',
  } });
  expect(createBackend).toHaveBeenCalledWith({ provider: 'http', model: 'laya', options: { baseUrl: 'http://localhost:8000' } });
});

it.each([
  ['--provider', 'other'], ['--model', 'kev'], ['--provider', 'http'],
  ['--provider', 'http', '--base-url', 'http://localhost', '--model-dir', '/model'],
  ['--provider', 'http', '--base-url', 'http://localhost', '--revision', 'main'],
  ['--base-url', 'http://localhost'], ['--timeout-ms', '100'],
])('rejects unsupported or conflicting provider settings %j', async (...flags) => {
  const createBackend = vi.fn();
  await expect(runCommand([workflow, '--input', input, ...flags], { createBackend, env: {} })).rejects.toThrow();
  expect(createBackend).not.toHaveBeenCalled();
});

it.each(['kev', 'jev'])('selects %s over HTTP and forwards an explicit model ID', async model => {
  const createBackend = vi.fn().mockResolvedValue(fakeBackend());
  await runCommand([workflow, '--input', input, '--provider', 'http', '--model', model, '--model-id', 'pinned-version'], {
    createBackend, stdout: vi.fn(), env: {
      BANH_INFERENCE_BASE_URL: 'http://localhost:8008',
      BANH_INFERENCE_TOKEN: 'secret', BANH_INFERENCE_MODEL_ID: 'ignored',
    },
  });
  expect(createBackend).toHaveBeenCalledWith({
    provider: 'http', model, options: { baseUrl: 'http://localhost:8008', token: 'secret', modelId: 'pinned-version' },
  });
});

it('allows Jev to use its default endpoint and environment model ID', async () => {
  const createBackend = vi.fn().mockResolvedValue(fakeBackend());
  await runCommand([workflow, '--input', input], { createBackend, stdout: vi.fn(), env: {
    BANH_PROVIDER: 'http', BANH_MODEL: 'jev', BANH_INFERENCE_TOKEN: 'secret', BANH_INFERENCE_MODEL_ID: 'jev-pinned',
  } });
  expect(createBackend).toHaveBeenCalledWith({
    provider: 'http', model: 'jev', options: { token: 'secret', modelId: 'jev-pinned' },
  });
});

it.each([
  ['--model', 'jev'],
  ['--model', 'unknown'],
  ['--model-id', 'multilingual'],
  ['--provider', 'http', '--model', 'kev'],
  ['--provider', 'http', '--model', 'jev'],
])('rejects invalid model/provider configuration %j', async (...flags) => {
  const createBackend = vi.fn();
  await expect(runCommand([workflow, '--input', input, ...flags], { createBackend, env: {} })).rejects.toThrow();
  expect(createBackend).not.toHaveBeenCalled();
});

it('resolves a workflow logical model locally and permits explicit family overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'banh-model-'));
  const path = join(dir, 'kev.yaml');
  const createBackend = vi.fn(async () => fakeBackend());
  try {
    await writeFile(path, supportYaml + '\nmodel: { provider: kev, model: kev-4b }\n');
    await runCommand([path, '--input', input], { createBackend, stdout: vi.fn(), env: { BANH_INFERENCE_BASE_URL: 'http://localhost:8009' } });
    expect(createBackend).toHaveBeenLastCalledWith({ provider: 'http', model: 'kev', options: { baseUrl: 'http://localhost:8009' } });
    await runCommand([path, '--input', input, '--provider', 'native', '--model', 'laya'], { createBackend, stdout: vi.fn(), env: {} });
    expect(createBackend).toHaveBeenLastCalledWith({ provider: 'native', model: 'laya', options: {} });
    await writeFile(path, supportYaml + '\nmodel: { provider: kev, model: kev-9b }\n');
    await expect(runCommand([path, '--input', input], { createBackend, env: {} })).rejects.toThrow('Unsupported logical model');
    expect(createBackend).toHaveBeenCalledTimes(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('selects HTTP automatically for Jev and preserves versioned YAML model IDs', async () => {
  const createBackend = vi.fn(async () => fakeBackend());
  const env = { BANH_INFERENCE_TOKEN: 'inference-only' };
  await runCommand([workflow, '--input', input, '--model', 'jev'], { createBackend, env, stdout: vi.fn() });
  expect(createBackend).toHaveBeenLastCalledWith({ provider: 'http', model: 'jev', options: { token: 'inference-only' } });
  await runCommand(['examples/jev-support-triage.yaml', '--input', input], { createBackend, env, stdout: vi.fn() });
  expect(createBackend).toHaveBeenLastCalledWith({ provider: 'http', model: 'jev', options: { token: 'inference-only', modelId: 'jev-1.13.0' } });
  await runCommand(['examples/jev-support-triage.yaml', '--input', input, '--model-id', 'jev-preview'], { createBackend, env, stdout: vi.fn() });
  expect(createBackend).toHaveBeenLastCalledWith({ provider: 'http', model: 'jev', options: { token: 'inference-only', modelId: 'jev-preview' } });
});
