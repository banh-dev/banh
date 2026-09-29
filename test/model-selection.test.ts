import { expect, it } from 'vitest';
import { compileProcess } from '@banh/dsl';
import { makeProcess } from './helpers.js';

it('preserves logical model selection without changing compiled questions', () => {
  const source = makeProcess();
  const selected = compileProcess({ ...source, model: { provider: 'kev', model: 'kev-4b' } });
  expect(selected.definition.model).toEqual({ provider: 'kev', model: 'kev-4b' });
  expect(selected.questions).toEqual(compileProcess(source).questions);
});
it.each([
  { provider: 'kev', model: 'https://untrusted.test' },
  { provider: 'kev', model: 'kev-4b', token: 'secret' },
  { provider: 'kev', model: 'kev-4b', baseUrl: 'https://untrusted.test' },
  { provider: 'kev' },
])('rejects infrastructure or incomplete model selection', model => {
  expect(() => compileProcess({ ...makeProcess(), model })).toThrow();
});
