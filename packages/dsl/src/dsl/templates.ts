import { ExpressionParseError } from './errors.js';
import { validateReference } from './expressions.js';
import type { ResultProperty } from './expressions.js';
import type { DecisionDefinition, JsonValue } from './types.js';

/** Only entire-string references are templates; ordinary strings are literals. */
export function parseTemplate(value: string): { decision: string; property: ResultProperty } | undefined {
  if (!value.includes('{{') && !value.includes('}}')) return undefined;
  const match = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\.(value|probability|confidence|accepted)\s*\}\}$/.exec(value);
  if (!match) throw new ExpressionParseError(`Invalid template "${value}"; use an entire string such as "{{ department.value }}"`);
  return { decision: match[1]!, property: match[2] as ResultProperty };
}

/** Report invalid references at their nested return-value path before inference. */
export function validateTemplates(value: JsonValue, decisions: Record<string, DecisionDefinition>, report: (path: (string | number)[], message: string) => void, path: (string | number)[] = []): void {
  if (typeof value === 'string') {
    try {
      const reference = parseTemplate(value);
      if (reference) validateReference(reference, decisions);
    } catch (error) { report(path, error instanceof Error ? error.message : String(error)); }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => validateTemplates(item, decisions, report, [...path, index]));
  } else if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => validateTemplates(item, decisions, report, [...path, key]));
  }
}
