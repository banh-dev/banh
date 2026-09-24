import { validateProcess } from '../dsl/parser.js';
import { compileDecisions } from './decisions.js';
import { parseExpression } from './expressions.js';

/** Validate and compile every rule before calling a backend. */
export function compileProcess(source: unknown) {
  const definition = validateProcess(source);
  return {
    definition,
    questions: compileDecisions(definition.decisions),
    flow: definition.flow.map(step => 'else' in step
      ? { expression: undefined, action: step.else }
      : { expression: parseExpression(step.when), action: step }),
  };
}
