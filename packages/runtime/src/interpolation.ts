import { ExpressionEvaluationError } from '@banh-dev/dsl';
import { parseTemplate } from '@banh-dev/dsl';
import type { JsonValue } from '@banh-dev/dsl';
import type { ExecutionContext } from './execution-context.js';

/** Recursively copy a return value, preserving the type of referenced results. */
export function interpolateValue(value: JsonValue, context: ExecutionContext): JsonValue {
  if (typeof value === 'string') {
    const reference = parseTemplate(value);
    if (!reference) return value;
    const result = Object.hasOwn(context.decisions, reference.decision) ? context.decisions[reference.decision] : undefined;
    const resolved = result?.[reference.property];
    if (resolved === undefined) throw new ExpressionEvaluationError(`Result "${reference.decision}.${reference.property}" is unavailable`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map(item => interpolateValue(item, context));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateValue(item, context)]));
  }
  return value;
}
