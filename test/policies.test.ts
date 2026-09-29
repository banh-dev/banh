import { expect, it } from 'vitest';
import { ProcessRuntime } from '@banh/runtime';
import { validateProcess } from '@banh/dsl';
import { fakeBackend } from './fake-backend.js';
import { makeProcess } from './helpers.js';

it.each([0, 0.8, 0.81, 1])('uses configured confidence minimum %s without another inference', async minimum => {
  const process = makeProcess();
  process.decisions.department!.confidence = { minimum };
  process.flow = [
    { when: 'department.accepted == false', do: 'return', value: { route: 'human_review' } },
    { else: { do: 'return', value: { route: '{{ department.value }}', accepted: '{{ department.accepted }}' } } },
  ];
  const backend = fakeBackend();
  const result = await new ProcessRuntime(backend).execute(process, {});
  expect(result.decisions.department!.accepted).toBe(minimum <= 0.8);
  expect(result.output).toEqual(minimum <= 0.8 ? { route: 'billing', accepted: true } : { route: 'human_review' });
  expect(backend.calls).toHaveLength(1);
});

it('fails a configured policy when confidence is unavailable', async () => {
  const process = makeProcess();
  process.decisions.urgent!.confidence = { minimum: 0 };
  const result = await new ProcessRuntime(fakeBackend()).execute(process, {});
  expect(result.decisions.urgent!.accepted).toBe(false);
});

it('interpolates nested arrays and objects while retaining types and leaving input unchanged', async () => {
  const process = makeProcess();
  process.flow = [{ else: { do: 'return', value: {
    answers: ['{{ urgent.value }}', '{{ severity.value }}', '{{ department.confidence }}', '{{ department.value }}'],
    nested: { accepted: '{{ urgent.accepted }}', unchanged: null },
  } } }];
  const before = structuredClone(process);
  const result = await new ProcessRuntime(fakeBackend()).execute(process, {});
  expect(result.output).toEqual({ answers: [false, 1.4, 0.8, 'billing'], nested: { accepted: true, unchanged: null } });
  expect(process).toEqual(before);
});

it.each(['{{ missing.value }}', '{{ urgent.raw }}', 'Route: {{ department.value }}', '{{ severity.probability }}', '{{ urgent.value.toString() }}'])('rejects invalid templates before inference: %s', async value => {
  const process = makeProcess();
  process.flow = [{ else: { do: 'return', value: { nested: [value] } } }];
  const backend = fakeBackend();
  await expect(new ProcessRuntime(backend).execute(process, {})).rejects.toThrow('flow[0].else.value.nested[0]');
  expect(backend.calls).toHaveLength(0);
});

it('reports unavailable interpolated metadata', async () => {
  const process = makeProcess();
  process.flow = [{ else: { do: 'return', value: '{{ urgent.confidence }}' } }];
  await expect(new ProcessRuntime(fakeBackend()).execute(process, {})).rejects.toThrow('urgent.confidence');
});

it.each([-0.01, 1.01, '0.8', null])('rejects malformed confidence minimum %s', minimum => {
  const process = makeProcess();
  expect(() => validateProcess({ ...process, decisions: { urgent: { decide: 'whether', question: 'Urgent?', confidence: { minimum } } } })).toThrow();
});
