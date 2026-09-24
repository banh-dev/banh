import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cloudCommand } from '../packages/cli/src/cloud/commands.js';
import { CloudClient } from '../packages/cli/src/cloud/client.js';
import { configPath, normalizeApiUrl, readConfig, saveConfig } from '../packages/cli/src/cloud/config.js';

const identity = { user: { id: 'usr_test', email: 'dev@example.test' }, account: { id: 'acct_test', name: 'Test account' } };
const token = `banh_dev_${'a'.repeat(64)}`;
let directory: string;
let file: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'banh-cli-')); file = join(directory, 'banh', 'config.json'); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const saved = () => ({ apiUrl: 'http://localhost:3000', token, accountId: 'acct_test' });
function dependencies() { return { env: {}, configFile: file, stdout: vi.fn(), fetch: vi.fn<typeof fetch>() }; }

it('validates a prompted token before saving it privately', async () => {
  const deps = dependencies(); deps.fetch.mockResolvedValue(response(identity));
  const promptToken = vi.fn().mockResolvedValue(token);
  await cloudCommand('login', ['--api-url', 'http://localhost:3000/v1/'], { ...deps, promptToken });
  expect(await readConfig(file)).toEqual(saved());
  if (process.platform !== 'win32') {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'banh'))).mode & 0o777).toBe(0o700);
  }
  expect(deps.fetch.mock.calls[0]![0]).toBe('http://localhost:3000/v1/me');
  expect(promptToken).toHaveBeenCalledOnce();
  expect(deps.stdout.mock.calls.flat().join(' ')).not.toContain(token);
});

it('preserves saved credentials when login fails', async () => {
  await saveConfig(file, saved());
  const deps = dependencies(); deps.fetch.mockResolvedValue(response({ error: { message: token } }, 401));
  await expect(cloudCommand('login', [], { ...deps, env: { BANH_API_TOKEN: 'invalid' } })).rejects.toThrow('Authentication failed');
  expect(await readConfig(file)).toEqual(saved());
});

it('uses environment credentials without saving them for CI', async () => {
  const deps = dependencies(); deps.fetch.mockResolvedValue(response(identity));
  await cloudCommand('whoami', ['--json'], { ...deps, env: { BANH_API_TOKEN: token, BANH_API_URL: 'http://localhost:3000' } });
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual(identity);
  expect(await readConfig(file)).toBeUndefined();
});

it('accepts plan-style lowercase environment names and uppercase takes precedence', async () => {
  const deps = dependencies(); deps.fetch.mockResolvedValue(response(identity));
  await cloudCommand('whoami', [], { ...deps, env: { banh_API_TOKEN: 'old', BANH_API_TOKEN: token, banh_API_URL: 'http://localhost:3000' } });
  expect(deps.fetch.mock.calls[0]![1]?.headers).toMatchObject({ authorization: `Bearer ${token}` });
});

it('does not send a saved token to a different API endpoint', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  await expect(cloudCommand('whoami', ['--api-url', 'https://other.example'], deps)).rejects.toThrow('No credentials for this API URL');
  expect(deps.fetch).not.toHaveBeenCalled();
});

it('uses a new environment token without inheriting the saved account restriction', async () => {
  await saveConfig(file, saved());
  const deps = dependencies(); deps.fetch.mockResolvedValue(response({ ...identity, account: { id: 'acct_other', name: 'Other' } }));
  await cloudCommand('whoami', ['--json'], { ...deps, env: { BANH_API_TOKEN: 'new-token' } });
  expect(JSON.parse(deps.stdout.mock.calls[0]![0]).account.id).toBe('acct_other');
});

it('checks explicit account selection before uploading', async () => {
  const deps = dependencies(); deps.fetch.mockResolvedValue(response(identity));
  await expect(cloudCommand('deploy', ['examples/warranty-claim.yaml'], { ...deps, env: { BANH_API_TOKEN: token, BANH_ACCOUNT_ID: 'acct_other' } })).rejects.toThrow('Configured account does not match');
  expect(deps.fetch).toHaveBeenCalledOnce();
});

it('validates and compiles workflows before upload and emits clean JSON', async () => {
  const deps = dependencies();
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ workflow: 'warranty_triage', version: 4 }, 201));
  await cloudCommand('deploy', ['examples/warranty-claim.yaml', '--json'], { ...deps, env: { BANH_API_TOKEN: token } });
  const [url, options] = deps.fetch.mock.calls[1]!;
  expect(url).toBe('http://127.0.0.1:3000/v1/accounts/acct_test/workflows/warranty_triage/versions');
  const body = JSON.parse(String(options?.body));
  expect(body.sourceYaml).toContain('process: warranty_triage');
  expect(body.compiled.definition.process).toBe('warranty_triage');
  expect(deps.stdout).toHaveBeenCalledOnce();
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual({ workflow: 'warranty_triage', version: 4, invokeUrl: 'http://127.0.0.1:3000/v1/accounts/acct_test/workflows/warranty_triage/runs' });
});

it('does not contact cloud for invalid or oversized YAML', async () => {
  const deps = dependencies(); const yaml = join(directory, 'invalid.yaml');
  await writeFile(yaml, 'version: 999');
  await expect(cloudCommand('deploy', [yaml], deps)).rejects.toThrow();
  await writeFile(yaml, '#'.repeat(65_537));
  await expect(cloudCommand('deploy', [yaml], deps)).rejects.toThrow('64 KiB');
  expect(deps.fetch).not.toHaveBeenCalled();
});

it('logout removes only saved config and remains usable with a corrupt config', async () => {
  await saveConfig(file, saved());
  await writeFile(file, 'not JSON');
  const deps = dependencies();
  await cloudCommand('logout', [], { ...deps, env: { BANH_API_TOKEN: token } });
  expect(await readConfig(file)).toBeUndefined();
  expect(deps.stdout.mock.calls.flat().join(' ')).toContain('still set in the environment');
  await cloudCommand('logout', [], deps);
  expect(deps.fetch).not.toHaveBeenCalled();
});

it('reports malformed config without exposing its contents', async () => {
  await saveConfig(file, saved()); await writeFile(file, token);
  await expect(readConfig(file)).rejects.toThrow('Invalid Banh configuration');
});

it.each([
  ['https://api.example/v1/', 'https://api.example'],
  ['http://localhost:3000/', 'http://localhost:3000'],
  ['http://[::1]:3000', 'http://[::1]:3000'],
])('normalizes API URL %s', (input, expected) => expect(normalizeApiUrl(input)).toBe(expected));
it.each(['http://remote.example', 'https://user:secret@api.example', 'https://api.example?token=secret', 'https://api.example/path', 'not a url'])('rejects unsuitable API URL %s', input => {
  expect(() => normalizeApiUrl(input)).toThrow();
});

it('uses native OS configuration locations and supports isolated profiles', () => {
  expect(configPath({ BANH_CONFIG_DIR: '/profile' }, 'linux', '/home/test')).toBe('/profile/config.json');
  expect(configPath({ XDG_CONFIG_HOME: '/config' }, 'linux', '/home/test')).toBe('/config/banh/config.json');
  expect(configPath({}, 'darwin', '/home/test')).toBe('/home/test/Library/Application Support/banh/config.json');
  expect(configPath({ APPDATA: '/roaming' }, 'win32', '/home/test')).toBe('/roaming/banh/config.json');
});

it('rejects unexpected flags and arguments without contacting cloud', async () => {
  const deps = dependencies();
  for (const command of ['login', 'logout', 'whoami', 'deploy'] as const) {
    await expect(cloudCommand(command, ['--typo'], deps)).rejects.toThrow();
  }
  await expect(cloudCommand('logout', ['extra'], deps)).rejects.toThrow();
  await expect(cloudCommand('deploy', [], deps)).rejects.toThrow();
  expect(deps.fetch).not.toHaveBeenCalled();
});

it('sanitizes server errors and rejects malformed success responses', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const client = new CloudClient(saved(), fetcher);
  fetcher.mockResolvedValueOnce(response({ secret: token, stack: 'private' }, 500));
  await expect(client.whoami()).rejects.toThrow('Banh Cloud request failed (HTTP 500).');
  fetcher.mockResolvedValueOnce(response({ token }));
  await expect(client.whoami()).rejects.toThrow('invalid identity response');
  fetcher.mockResolvedValueOnce(new Response('not JSON'));
  await expect(client.whoami()).rejects.toThrow('invalid JSON response');
});

it('refuses redirects instead of forwarding bearer credentials', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    response.writeHead(302, { location: '/redirect-target' }).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  try {
    await expect(new CloudClient({ apiUrl: `http://127.0.0.1:${address.port}`, token }).whoami()).rejects.toThrow('Unable to reach');
    expect(requests).toEqual(['/v1/me']);
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});

it('times out network requests', async () => {
  const server = createServer(() => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  try {
    await expect(new CloudClient({ apiUrl: `http://127.0.0.1:${address.port}`, token }, fetch, 20).whoami()).rejects.toThrow('timed out');
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});
