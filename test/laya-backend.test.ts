import { beforeEach, expect, it, vi } from 'vitest';
import { LayaBackend, normalizeLayaEvaluation, toLayaQuestions } from '@banh/laya';
import { compileDecisions } from '@banh/dsl';
import { makeProcess } from './helpers.js';

const sdk = vi.hoisted(() => ({ load: vi.fn(), systemOne: vi.fn(), close: vi.fn() }));
vi.mock('@receptron/laya', () => ({ Laya: { load: sdk.load } }));
const questions = compileDecisions(makeProcess().decisions);
function response() {
  return {
    answers: {
      department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, support: 0.08, sales: 0.02 }, confidence: 0.8 },
      urgent: { type: 'noul', noul: 0.5, rl_agent: { act_probability: 0.7 } },
      severity: { type: 'score', score: 2.6, probabilities: { '0': 0, '1': 0, '2': 0.4, '3': 0.6 }, confidence: 0.6 },
    },
    usage: { input_tokens: 267, output_tokens: 0 },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  sdk.load.mockResolvedValue({ systemOne: sdk.systemOne, close: sdk.close });
  sdk.systemOne.mockResolvedValue(response());
});

it('normalizes all answer types without rounding or fabricating confidence', () => {
  const raw = response();
  const result = normalizeLayaEvaluation(raw, questions);
  expect(result.decisions.department).toMatchObject({ kind: 'one_of', value: 'billing', probability: 0.9, confidence: 0.8 });
  expect(result.decisions.urgent).toEqual({ id: 'urgent', kind: 'whether', value: true, probability: 0.5, raw: raw.answers.urgent });
  expect(result.decisions.severity).toMatchObject({ kind: 'scale', value: 2.6, probabilities: raw.answers.severity.probabilities });
  expect(result.decisions.department!.raw).toBe(raw.answers.department);
  expect(result.usage).toEqual({ inputTokens: 267 });
  raw.answers.urgent.noul = 0.499;
  expect(normalizeLayaEvaluation(raw, questions).decisions.urgent!.value).toBe(false);
});

it('loads once, batches each execution, and closes once', async () => {
  const backend = await LayaBackend.create({ modelDir: '/local/model' });
  await backend.evaluate('ticket', questions);
  await backend.evaluate('another ticket', questions);
  expect(sdk.load).toHaveBeenCalledExactlyOnceWith({ modelDir: '/local/model' });
  expect(sdk.systemOne).toHaveBeenCalledTimes(2);
  expect(sdk.systemOne).toHaveBeenCalledWith('ticket', toLayaQuestions(questions));
  await backend.close();
  await backend.close();
  expect(sdk.close).toHaveBeenCalledTimes(1);
  await expect(backend.evaluate('ticket', questions)).rejects.toThrow('closed');
});

it.each([
  {},
  { ...response(), answers: {} },
  { ...response(), usage: { input_tokens: -1 } },
  { ...response(), answers: { ...response().answers, urgent: { type: 'noul', noul: 1.1 } } },
  { ...response(), answers: { ...response().answers, severity: { ...response().answers.severity, score: 4 } } },
  { ...response(), answers: { ...response().answers, department: { ...response().answers.department, choice: 'unknown' } } },
  { ...response(), answers: { ...response().answers, department: { ...response().answers.department, probabilities: { billing: 0.9 } } } },
])('rejects malformed responses %#', response => {
  expect(() => normalizeLayaEvaluation(response, questions)).toThrow();
});

it('wraps load, inference, and close failures with context', async () => {
  sdk.load.mockRejectedValueOnce(new Error('missing weights'));
  await expect(LayaBackend.create()).rejects.toThrow('Unable to load Laya: missing weights');
  const backend = await LayaBackend.create();
  sdk.systemOne.mockRejectedValueOnce(new Error('session failed'));
  await expect(backend.evaluate({}, questions)).rejects.toThrow('Laya inference failed: session failed');
  sdk.close.mockRejectedValueOnce(new Error('release failed'));
  await expect(backend.close()).rejects.toThrow('Unable to close Laya: release failed');
});

it('translates Banh primitives to the SDK and HTTP protocol', () => {
  expect(toLayaQuestions({
    route: { type: 'one_of', question: 'Where?', options: { a: 'A', b: 'B' } },
    urgent: { type: 'whether', question: 'Urgent?' },
    severity: { type: 'scale', question: 'How bad?', levels: ['low', 'high'] },
  })).toEqual({
    route: { type: 'choice', instructions: 'Where?', criteria: { a: 'A', b: 'B' } },
    urgent: { type: 'noul', instructions: 'Urgent?' },
    severity: { type: 'score', instructions: 'How bad?', criteria: ['low', 'high'] },
  });
});
