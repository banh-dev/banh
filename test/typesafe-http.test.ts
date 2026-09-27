import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { LayaBackend } from '@banh/laya';
import { TypeSafeHttpBackend, toTypeSafeQuestions } from '@banh/typesafe';
import { createProvider } from '@banh/providers';
import { compileDecisions } from '@banh/dsl';
import { ProcessRuntime } from '@banh/runtime';
import { makeProcess } from './helpers.js';

const sdk = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@receptron/laya', () => ({ Laya: { load: sdk.load } }));
const questions = compileDecisions(makeProcess().decisions);
const answer = {
  answers: {
    department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, support: 0.08, sales: 0.02 }, confidence: 0.8 },
    urgent: { type: 'noul', noul: 0.1 },
    severity: { type: 'score', score: 1.4, probabilities: { '0': 0, '1': 0.6, '2': 0.4, '3': 0 }, confidence: 0.5 },
  },
  usage: { input_tokens: 42, output_tokens: 0 },
};
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.clearAllMocks();
});
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  cleanup.push(() => new Promise<void>((resolve, reject) => {
    instance.close(error => error ? reject(error) : resolve());
    instance.closeAllConnections();
  }));
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return 'http://127.0.0.1:' + address.port;
}

it.each(['', '/', '/v1', '/v1/', '/prefix', '/prefix/v1/'])('posts the Laya wire contract with base path %s', async prefix => {
  let request: unknown;
  let auth: string | undefined;
  let path: string | undefined;
  let method: string | undefined;
  const baseUrl = await server((req, res) => {
    auth = req.headers.authorization;
    path = req.url;
    method = req.method;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { request = JSON.parse(body); res.end(JSON.stringify(answer)); });
  });
  const backend = await createProvider({ provider: 'http', model: 'laya', options: { baseUrl: baseUrl + prefix, token: 'secret' } });
  const result = await new ProcessRuntime(backend).execute(makeProcess(), { ticket: 'refund' });
  expect(result.output).toEqual({ route: 'billing' });
  expect(request).toEqual({ state: { ticket: 'refund' }, questions: toTypeSafeQuestions(questions) });
  expect(method).toBe('POST');
  expect(path).toBe((prefix.startsWith('/prefix') ? '/prefix' : '') + '/v1/systemone');
  expect(auth).toBe('Bearer secret');
  expect(sdk.load).not.toHaveBeenCalled();
  await backend.close();
  await backend.close();
  await expect(backend.evaluate({}, questions)).rejects.toThrow('closed');
});

it('matches native normalization and omits authorization when no token is supplied', async () => {
  const baseUrl = await server((req, res) => {
    expect(req.headers.authorization).toBeUndefined();
    res.end(JSON.stringify(answer));
  });
  sdk.load.mockResolvedValue({ systemOne: async () => answer, close: async () => {} });
  const native = await LayaBackend.create();
  const http = new TypeSafeHttpBackend({ baseUrl });
  expect(await http.evaluate('ticket', questions)).toEqual(await native.evaluate('ticket', questions));
  await native.close();
  await http.close();
});

it.each([401, 422, 500, 503, 307])('reports status %i without retrying, redirecting, or exposing response bodies', async status => {
  let calls = 0;
  const baseUrl = await server((_req, res) => {
    calls++;
    res.writeHead(status, { Location: '/elsewhere' });
    res.end('private input or token');
  });
  const http = new TypeSafeHttpBackend({ baseUrl });
  await expect(http.evaluate({}, questions)).rejects.toThrow('TypeSafe HTTP request failed (status ' + status + ')');
  expect(calls).toBe(1);
});

it.each(['not json', '{}', JSON.stringify({ ...answer, answers: {} })])('rejects invalid responses %s', async body => {
  const baseUrl = await server((_req, res) => res.end(body));
  await expect(new TypeSafeHttpBackend({ baseUrl }).evaluate({}, questions)).rejects.toThrow();
});

it('times out while reading an unfinished response body', async () => {
  const baseUrl = await server((_req, res) => { res.writeHead(200); res.write('{'); });
  await expect(new TypeSafeHttpBackend({ baseUrl, timeoutMs: 40 }).evaluate({}, questions)).rejects.toThrow('timed out');
});

it('closing aborts an in-flight request', async () => {
  let received!: () => void;
  const arrival = new Promise<void>(resolve => { received = resolve; });
  const baseUrl = await server(() => received());
  const http = new TypeSafeHttpBackend({ baseUrl });
  const pending = expect(http.evaluate({}, questions)).rejects.toThrow('closed');
  await arrival;
  await http.close();
  await pending;
});

it('reports connection failures', async () => {
  const baseUrl = await server(() => {});
  await cleanup.pop()!();
  await expect(new TypeSafeHttpBackend({ baseUrl }).evaluate({}, questions)).rejects.toThrow('TypeSafe HTTP request failed');
});

it.each(['file:///tmp/model', 'bad', 'http://user:secret@localhost', 'http://localhost?x=1', 'http://localhost/#x'])('rejects invalid base URL %s', baseUrl => {
  expect(() => new TypeSafeHttpBackend({ baseUrl })).toThrow();
});
it.each([0, -1, NaN, Infinity, 1.5, 2147483648])('rejects invalid timeout %s', timeoutMs => {
  expect(() => new TypeSafeHttpBackend({ baseUrl: 'http://localhost', timeoutMs })).toThrow('timeout');
});

it('defaults the provider factory to native Laya', async () => {
  const close = vi.fn();
  sdk.load.mockResolvedValue({ systemOne: async () => answer, close });
  const backend = await createProvider();
  expect(sdk.load).toHaveBeenCalledWith({});
  await backend.close();
  expect(close).toHaveBeenCalledOnce();
});

it.each(['', 'bad\r\nheader', 'a token'])('rejects invalid bearer tokens', token => {
  expect(() => new TypeSafeHttpBackend({ baseUrl: 'http://localhost', token })).toThrow('bearer token');
});

it.each([
  { model: 'laya' as const, wireModel: undefined },
  { model: 'kev' as const, wireModel: 'kev-latest' },
  { model: 'jev' as const, wireModel: 'jev-latest' },
])('uses the shared HTTP implementation for $model', async ({ model, wireModel }) => {
  let request: Record<string, unknown> = {};
  let auth: string | undefined;
  const baseUrl = await server((req, res) => {
    auth = req.headers.authorization;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      request = JSON.parse(body);
      res.end(JSON.stringify({
        ...answer,
        model: wireModel ?? 'english',
        answers: { ...answer.answers,
          severity: { ...answer.answers.severity, legend: { '0': 'negligible', '1': 'minor', '2': 'significant', '3': 'critical' } },
        },
      }));
    });
  });
  const backend = await createProvider({ provider: 'http', model, options: { baseUrl, token: 'secret' } });
  const result = await new ProcessRuntime(backend).execute(makeProcess(), 'refund');
  expect(result.output).toEqual({ route: 'billing' });
  expect(result.decisions.urgent).toMatchObject({ value: false, probability: 0.1 });
  expect(result.decisions.urgent!.confidence).toBeUndefined();
  expect(result.decisions.severity).toMatchObject({ value: 1.4, confidence: 0.5 });
  expect(result.decisions.severity!.raw).toHaveProperty('legend');
  expect(request.model).toBe(wireModel);
  expect(Object.hasOwn(request, 'model')).toBe(wireModel !== undefined);
  expect(auth).toBe('Bearer secret');
  expect(sdk.load).not.toHaveBeenCalled();
  await backend.close();
});

it.each([
  ['laya', 'multilingual'],
  ['kev', 'kev-custom'],
  ['jev', 'jev-1.13.0'],
] as const)('forwards an exact model ID for %s', async (model, modelId) => {
  let request: Record<string, unknown> = {};
  const baseUrl = await server((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { request = JSON.parse(body); res.end(JSON.stringify(answer)); });
  });
  const backend = await createProvider({ provider: 'http', model, options: { baseUrl, token: 'secret', modelId } });
  await backend.evaluate('ticket', questions);
  expect(request.model).toBe(modelId);
  await backend.close();
});

it('defaults Jev to the official endpoint and sends its required model and token', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(answer)));
  try {
    const backend = await createProvider({ provider: 'http', model: 'jev', options: { token: 'secret' } });
    await backend.evaluate('ticket', questions);
    expect(fetch).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      body: JSON.stringify({ state: 'ticket', questions: toTypeSafeQuestions(questions), model: 'jev-latest' }),
    }));
    await backend.close();
  } finally { fetch.mockRestore(); }
});

it('requires an explicit server for self-hosted models and a token for Jev', async () => {
  await expect(createProvider({ provider: 'http', model: 'laya', options: {} })).rejects.toThrow('base-url');
  await expect(createProvider({ provider: 'http', model: 'kev', options: {} })).rejects.toThrow('base-url');
  await expect(createProvider({ provider: 'http', model: 'jev', options: {} })).rejects.toThrow('bearer token');
});

it.each(['', '   ', 'bad\nmodel'])('rejects invalid wire model IDs', async modelId => {
  await expect(createProvider({ provider: 'http', model: 'kev', options: { baseUrl: 'http://localhost', modelId } })).rejects.toThrow('model ID');
});
