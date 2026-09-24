import { expect, it, vi } from 'vitest';
import { ProcessRuntime } from '@banh/runtime';
import { makeProcess } from './helpers.js';
import { fakeBackend } from './fake-backend.js';

it('sends all questions in one call and exposes answers, usage, timing, and diagnostics', async () => {
  const backend = fakeBackend();
  const onEvent = vi.fn();
  const result = await new ProcessRuntime(backend, { onEvent }).execute(makeProcess(), { ticket: 'refund' });
  expect(backend.calls).toHaveLength(1);
  expect(Object.keys(backend.calls[0]!.questions)).toEqual(['department', 'urgent', 'severity']);
  expect(backend.calls[0]!.state).toEqual({ ticket: 'refund' });
  expect(result.output).toEqual({ route: 'billing' });
  expect(result.decisions).toMatchObject(backend.evaluation.decisions);
  expect(result.decisions.department!.accepted).toBe(true);
  expect(result.usage).toEqual({ inputTokens: 42 });
  expect(result.timing.totalMs).toBeGreaterThanOrEqual(result.timing.inferenceMs!);
  expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['inference:start', 'inference:end', 'flow:match', 'flow:return']);
  expect(backend.closed).toBe(false);
});

it('first match wins, then falls back when no conditions match', async () => {
  const backend = fakeBackend();
  const runtime = new ProcessRuntime(backend);
  backend.evaluation.decisions.urgent!.probability = 0.95;
  expect((await runtime.execute(makeProcess(), {})).output).toEqual({ route: 'escalation' });
  backend.evaluation.decisions.urgent!.probability = 0.1;
  backend.evaluation.decisions.department!.value = 'support';
  expect((await runtime.execute(makeProcess(), {})).output).toEqual({ route: 'support' });
  expect(backend.calls).toHaveLength(2);
});

it('validates definitions and input before inference', async () => {
  const backend = fakeBackend();
  const runtime = new ProcessRuntime(backend);
  await expect(runtime.execute({}, {})).rejects.toThrow('Invalid workflow');
  await expect(runtime.execute({ ...makeProcess(), input: { type: 'text' } }, {})).rejects.toThrow('Input must be text');
  await expect(runtime.execute(makeProcess(), undefined)).rejects.toThrow('JSON-compatible');
  expect(backend.calls).toHaveLength(0);
});

it('surfaces backend failures and missing answers', async () => {
  const backend = fakeBackend();
  delete backend.evaluation.decisions.urgent;
  await expect(new ProcessRuntime(backend).execute(makeProcess(), {})).rejects.toThrow('urgent');
  vi.spyOn(backend, 'evaluate').mockRejectedValue(new Error('device failed'));
  await expect(new ProcessRuntime(backend).execute(makeProcess(), {})).rejects.toThrow('Inference failed: device failed');
});

it('reports no matching rule and supports an explicit null output', async () => {
  const process = makeProcess();
  process.flow = [{ when: 'urgent.value == true', do: 'return', value: null }];
  const runtime = new ProcessRuntime(fakeBackend());
  await expect(runtime.execute(process, {})).rejects.toThrow('No flow rule matched');
  process.flow.push({ else: { do: 'return', value: null } });
  expect((await runtime.execute(process, {})).output).toBeNull();
});

it.each([NaN, Infinity, -1, 4])('rejects invalid normalized scale value %s', async value => {
  const backend = fakeBackend();
  backend.evaluation.decisions.severity!.value = value;
  await expect(new ProcessRuntime(backend).execute(makeProcess(), {})).rejects.toThrow();
});
