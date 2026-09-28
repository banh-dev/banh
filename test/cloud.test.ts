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
const token = 'auth0-access-token';
let directory: string;
let file: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'banh-cli-')); file = join(directory, 'banh', 'config.json'); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const saved = () => ({ apiUrl: 'http://localhost:3000', token, accountId: 'acct_test' });
function dependencies() { return { env: {}, configFile: file, stdout: vi.fn(), fetch: vi.fn<typeof fetch>() }; }

it('validates an environment access token before saving it privately', async () => {
  const deps = dependencies(); deps.fetch.mockResolvedValue(response(identity));
  await cloudCommand('login', ['--api-url', 'http://localhost:3000/v1/'], { ...deps, env: { BANH_API_TOKEN: token } });
  expect(await readConfig(file)).toEqual(saved());
  if (process.platform !== 'win32') {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'banh'))).mode & 0o777).toBe(0o700);
  }
  expect(deps.fetch.mock.calls[0]![0]).toBe('http://localhost:3000/v1/me');
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
  expect(url).toBe('https://api.banh.dev/v1/accounts/acct_test/workflows/warranty_triage/versions');
  const body = JSON.parse(String(options?.body));
  expect(body.sourceYaml).toContain('process: warranty_triage');
  expect(body.compiled.definition.process).toBe('warranty_triage');
  expect(deps.stdout).toHaveBeenCalledOnce();
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual({ workflow: 'warranty_triage', version: 4, invokeUrl: 'https://api.banh.dev/v1/accounts/acct_test/workflows/warranty_triage/runs' });
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

it('completes device login through cloud discovery and saves only a verified access token', async () => {
  const deps = dependencies();
  const expiryBase = Date.now();
  const openBrowser = vi.fn(async () => {});
  deps.fetch.mockResolvedValueOnce(response({ issuer: 'https://tenant.example/', clientId: 'native-cli', audience: 'api' }))
    .mockResolvedValueOnce(response({ device_code: 'device-secret', user_code: 'ABCD', verification_uri: 'https://tenant.example/activate', expires_in: 60, interval: 1 }))
    .mockResolvedValueOnce(response({ access_token: token, token_type: 'Bearer', expires_in: 3600 }))
    .mockResolvedValueOnce(response(identity));
  await cloudCommand('login', ['--api-url', 'http://localhost:3000', '--no-browser'], {
    ...deps, device: { sleep: async () => {}, now: () => expiryBase, openBrowser },
  });
  expect(await readConfig(file)).toEqual({ ...saved(), expiresAt: expiryBase + 3_600_000 });
  expect(openBrowser).not.toHaveBeenCalled();
  expect(deps.fetch.mock.calls.map(call => call[0])).toEqual([
    'http://localhost:3000/v1/auth/config', 'https://tenant.example/oauth/device/code',
    'https://tenant.example/oauth/token', 'http://localhost:3000/v1/me',
  ]);
  expect(deps.fetch.mock.calls[3]![1]?.headers).toMatchObject({ authorization: `Bearer ${token}` });
  const output = deps.stdout.mock.calls.flat().join(' ');
  expect(output).toContain('Logged in as');
  expect(output).not.toContain(token);
  expect(output).not.toContain('device-secret');
});

it('invokes with saved login and sends JSON input without fetching identity', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  const result = { id: 'run_test', workflow: 'warranty_triage', version: 1, status: 'completed', output: { action: 'approve' }, decisions: {}, trace: { backend: 'laya' } };
  deps.fetch.mockResolvedValue(response(result));
  await cloudCommand('invoke', ['warranty_triage', '--input', 'examples/inputs/warranty-claim.json', '--json'], deps);
  expect(deps.fetch).toHaveBeenCalledOnce();
  expect(deps.fetch.mock.calls[0]![0]).toBe('http://localhost:3000/v1/accounts/acct_test/workflows/warranty_triage/runs');
  expect(JSON.parse(String(deps.fetch.mock.calls[0]![1]?.body)).input.product).toBe('Desk lamp');
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual(result);
});

it('supports invocation keys with explicit account and text input', async () => {
  const deps = dependencies();
  deps.fetch.mockResolvedValue(response({ id: 'run_text', workflow: 'triage', version: 1, status: 'completed', output: {}, decisions: {}, trace: {} }));
  await cloudCommand('invoke', ['triage', '--text', 'Help'], { ...deps, env: { BANH_API_TOKEN: 'banh_sk_test', BANH_ACCOUNT_ID: 'acct_test' } });
  expect(deps.fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(String(deps.fetch.mock.calls[0]![1]?.body))).toEqual({ input: 'Help' });
});

it('prints persisted failed runs as JSON and reports failure', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  const result = { id: 'run_failed', workflow: 'triage', version: 1, status: 'failed', output: null, decisions: {}, trace: null, error: { code: 'EXECUTION_TIMEOUT' } };
  deps.fetch.mockResolvedValue(response(result, 504));
  await expect(cloudCommand('invoke', ['triage', '--text', 'Help', '--json'], deps)).rejects.toThrow('EXECUTION_TIMEOUT');
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual(result);
});

it('rejects malformed invocation input before sending requests', async () => {
  const deps = dependencies();
  for (const args of [['triage'], ['../bad', '--text', 'Hi'], ['triage', '--input', 'missing.json'], ['triage', '--input', 'file', '--text', 'Hi']]) {
    await expect(cloudCommand('invoke', args, deps)).rejects.toThrow();
  }
  expect(deps.fetch).not.toHaveBeenCalled();
});

const historyRun = { id: 'run_history', workflow: 'triage', version: 2, status: 'completed', durationMs: 123.4,
  createdAt: '2026-09-25T17:00:00.000Z', completedAt: '2026-09-25T17:00:00.123Z',
  output: { action: 'review' }, decisions: { valid: { probability: 0.3 } }, trace: { backend: 'laya' } };

it('lists runs with pagination and clean JSON', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  const page = { runs: [historyRun], limit: 10, offset: 20 };
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response(page));
  await cloudCommand('runs', ['triage', '--limit', '10', '--offset', '20', '--json'], deps);
  expect(deps.fetch.mock.calls[1]![0]).toBe('http://localhost:3000/v1/accounts/acct_test/workflows/triage/runs?limit=10&offset=20');
  expect(deps.stdout).toHaveBeenCalledOnce();
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual(page);
});

it('renders empty history and running records', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ runs: [], limit: 50, offset: 0 }));
  await cloudCommand('runs', ['triage'], deps);
  expect(deps.stdout).toHaveBeenLastCalledWith('No runs found for triage.');
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ runs: [{ ...historyRun, status: 'running', durationMs: null, completedAt: null, output: null, trace: null }], limit: 50, offset: 0 }));
  await cloudCommand('runs', ['triage'], deps);
  expect(deps.stdout.mock.lastCall![0]).toContain('running');
  expect(deps.stdout.mock.lastCall![0]).toContain('v2');
});

it('inspects failed runs with full details without failing the inspection command', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  const record = { ...historyRun, status: 'failed', input: { message: 'help' }, error: { code: 'EXECUTION_TIMEOUT', message: 'Workflow execution timed out' } };
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response(record));
  await cloudCommand('inspect', ['run_history'], deps);
  expect(deps.fetch.mock.calls[1]![0]).toBe('http://localhost:3000/v1/accounts/acct_test/runs/run_history');
  const output = deps.stdout.mock.lastCall![0];
  for (const part of ['EXECUTION_TIMEOUT', 'Input', 'help', 'Decisions', '0.3', 'Output', 'Trace', 'laya']) expect(output).toContain(part);
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response(record));
  await cloudCommand('inspect', ['run_history', '--json'], deps);
  expect(JSON.parse(deps.stdout.mock.lastCall![0])).toEqual(record);
});

it('rejects invalid history arguments before authentication', async () => {
  const deps = dependencies();
  for (const args of [['triage', '--limit', '0'], ['triage', '--limit', '101'], ['triage', '--offset', '-1'], ['triage', '--offset', '10001'], ['triage', '--limit', '1.5'], ['../bad']]) {
    await expect(cloudCommand('runs', args, deps)).rejects.toThrow();
  }
  await expect(cloudCommand('inspect', ['../run'], deps)).rejects.toThrow('Invalid run ID');
  expect(deps.fetch).not.toHaveBeenCalled();
});

it('rejects malformed and mismatched history responses', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const client = new CloudClient(saved(), fetcher);
  fetcher.mockResolvedValueOnce(response({ runs: [{ ...historyRun, workflow: 'other' }], limit: 50, offset: 0 }));
  await expect(client.runs('acct_test', 'triage')).rejects.toThrow('invalid run list');
  fetcher.mockResolvedValueOnce(response({ ...historyRun, input: {}, id: 'run_other' }));
  await expect(client.inspect('acct_test', 'run_history')).rejects.toThrow('invalid run record');
  fetcher.mockResolvedValueOnce(response(historyRun));
  await expect(client.inspect('acct_test', 'run_history')).rejects.toThrow('invalid run record');
  fetcher.mockResolvedValueOnce(response({ ...historyRun, input: {}, durationMs: 'slow' }));
  await expect(client.inspect('acct_test', 'run_history')).rejects.toThrow('invalid run record');
});

it('does not leak error response bodies when history access is denied or missing', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const client = new CloudClient(saved(), fetcher);
  fetcher.mockResolvedValueOnce(response({ secret: token }, 403));
  await expect(client.runs('acct_test', 'triage')).rejects.toThrow('Access denied');
  fetcher.mockResolvedValueOnce(response({ secret: token }, 404));
  await expect(client.inspect('acct_test', 'run_history')).rejects.toThrow('not found in the selected account');
});

it('reports billing usage and opens only validated Stripe checkout URLs', async () => {
  await saveConfig(file, saved()); const deps=dependencies();
  const status={mode:'test',status:'active',plan:'starter',periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-10-01T00:00:00Z',limit:1000,used:12,reserved:1,remaining:987,retentionDays:7,cancelAtPeriodEnd:false};
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response(status));
  await cloudCommand('billing',['--json'],deps);
  expect(JSON.parse(deps.stdout.mock.lastCall![0])).toEqual(status);
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({url:'https://checkout.stripe.com/test'}));
  await cloudCommand('billing',['checkout','starter'],deps);
  expect(deps.stdout.mock.lastCall![0]).toBe('Open https://checkout.stripe.com/test');
  expect(JSON.parse(String(deps.fetch.mock.lastCall![1]?.body))).toEqual({plan:'starter'});
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({url:'https://attacker.example'}));
  await expect(cloudCommand('billing',['portal'],deps)).rejects.toThrow('Invalid billing URL');
});
it('validates billing commands before sending credentials',async()=>{
  const deps=dependencies();
  for(const args of [['checkout'],['checkout','enterprise'],['status','extra'],['unknown']]) await expect(cloudCommand('billing',args,deps)).rejects.toThrow('Usage');
  expect(deps.fetch).not.toHaveBeenCalled();
});

it.each([
  { decisions: undefined }, { decisions: [] }, { trace: null }, { output: undefined },
  { error: { code: 'unexpected' } },
])('rejects malformed completed invocation responses', async override => {
  const result = { id: 'run_test', workflow: 'triage', version: 1, status: 'completed', output: null, decisions: {}, trace: {}, ...override };
  const client = new CloudClient({ apiUrl: 'https://api.banh.dev', token }, vi.fn<typeof fetch>().mockResolvedValue(response(result)));
  await expect(client.invoke('acct_test', 'triage', {})).rejects.toThrow('invalid run response');
});

it('uses the hosted API for a fresh login unless explicitly overridden', async () => {
  const deps = dependencies();
  deps.fetch.mockResolvedValue(response(identity));
  await cloudCommand('login', [], { ...deps, env: { BANH_API_TOKEN: token } });
  expect(deps.fetch.mock.calls[0]![0]).toBe('https://api.banh.dev/v1/me');
});

it('explains the hosted input budget when a request is too large', async () => {
  const client = new CloudClient(saved(), vi.fn<typeof fetch>().mockResolvedValue(
    response({ message: 'private upstream details' }, 413),
  ));
  await expect(client.whoami()).rejects.toThrow('approximate 8,000-token input limit; rejected requests use no run allowance');
});

it('creates, lists, and revokes invocation keys without saving the secret', async () => {
  await saveConfig(file, saved());
  const deps = dependencies();
  const apiKey = `banh_sk_${'a'.repeat(64)}`;
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ id: 'key_test', apiKey }, 201));
  await cloudCommand('keys', ['create', '--json'], deps);
  expect(JSON.parse(deps.stdout.mock.calls[0]![0])).toEqual({ id: 'key_test', apiKey });
  expect(await readConfig(file)).toEqual(saved());
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ keys: [{ id: 'key_test', prefix: apiKey.slice(0, 18), createdAt: new Date().toISOString(), revokedAt: null, apiKey }] }));
  deps.stdout.mockClear();
  await cloudCommand('keys', ['list', '--json'], deps);
  expect(deps.stdout.mock.calls[0]![0]).not.toContain(apiKey);
  deps.fetch.mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({ id: 'key_test', revoked: true }));
  await cloudCommand('keys', ['revoke', 'key_test'], deps);
  expect(deps.fetch.mock.calls.at(-1)![0]).toBe('http://localhost:3000/v1/accounts/acct_test/keys/key_test/revoke');
});
it('rejects malformed key commands before contacting the server', async () => {
  const deps = dependencies();
  for (const args of [['unknown'], ['revoke'], ['revoke', '../other'], ['create', 'extra']]) {
    await expect(cloudCommand('keys', args, deps)).rejects.toThrow('Usage: banh keys');
  }
  expect(deps.fetch).not.toHaveBeenCalled();
});

it.each([429, 503])('explains temporary inference limits for HTTP %s without retrying', async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status, headers: { 'retry-after': '60' } }));
  const client = new CloudClient(saved(), fetcher);
  await expect(client.invoke('acct_test', 'controls', {})).rejects.toThrow('Retry in 60 seconds. No run allowance was used.');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
