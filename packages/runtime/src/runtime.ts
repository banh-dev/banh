import { z } from 'zod';
import { compileProcess } from '@banh/dsl';
import { BackendError, RuntimeError } from '@banh/dsl';
import type { SystemOneBackend, ProviderExecutionOptions } from './system-one-backend.js';
import type { ProcessExecutionResult } from './result.js';
import { evaluateExpression } from './evaluator.js';
import { interpolateValue } from './interpolation.js';

const probability = z.number().min(0).max(1);
const resultSchema = z.object({
  id: z.string(), kind: z.enum(['one_of', 'whether', 'scale']),
  value: z.union([z.string(), z.boolean(), z.number()]),
  probability: probability.optional(), confidence: probability.optional(),
  probabilities: z.record(z.string(), probability).optional(), raw: z.unknown(),
});

/** Optional diagnostics emitted in execution order. */
export type RuntimeEvent =
  | { type: 'inference:start'; decisionCount: number }
  | { type: 'inference:end'; durationMs: number }
  | { type: 'flow:match'; index: number }
  | { type: 'flow:return'; value: unknown };

/** Validate input before loading a model or invoking inference. */
export function validateInput(input: unknown, type?: 'json' | 'text'): void {
  if (type === 'text') {
    if (typeof input !== 'string') throw new RuntimeError('Input must be text');
  } else if (!z.json().safeParse(input).success) {
    throw new RuntimeError('Input must be a JSON-compatible value');
  }
}

/** Executes one inference batch followed by deterministic first-match rules.
 * The caller owns the backend and must close it after all executions finish.
 */
export class ProcessRuntime {
  constructor(private readonly backend: SystemOneBackend, private readonly options: { onEvent?: (event: RuntimeEvent) => void } = {}) {}

  async execute(source: unknown, input: unknown, executionOptions: ProviderExecutionOptions = {}): Promise<ProcessExecutionResult> {
    const start = performance.now();
    const plan = compileProcess(source);
    validateInput(input, plan.definition.input?.type);
    this.options.onEvent?.({ type: 'inference:start', decisionCount: Object.keys(plan.questions).length });
    const inferenceStart = performance.now();
    let evaluation;
    try {
      evaluation = await this.backend.evaluate(input, plan.questions, executionOptions);
    } catch (cause) {
      if (cause instanceof BackendError) throw cause;
      throw new BackendError(`Inference failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
    const inferenceMs = performance.now() - inferenceStart;
    this.options.onEvent?.({ type: 'inference:end', durationMs: inferenceMs });
    for (const [id, definition] of Object.entries(plan.definition.decisions)) {
      const result = Object.hasOwn(evaluation.decisions, id) ? evaluation.decisions[id] : undefined;
      const expected = definition.decide === 'whether' ? 'boolean' : definition.decide === 'scale' ? 'number' : 'string';
      if (!resultSchema.safeParse(result).success || !result || result.id !== id || result.kind !== definition.decide || typeof result.value !== expected) {
        throw new BackendError(`Missing or invalid result for decision "${id}"`);
      }
      if (definition.decide === 'one_of' && !Object.hasOwn(definition.options, String(result.value))) {
        throw new BackendError(`Unknown option returned for decision "${id}"`);
      }
      if (definition.decide === 'scale' && typeof result.value === 'number' &&
          (result.value < 0 || result.value > definition.levels.length - 1)) {
        throw new BackendError(`Out-of-range score returned for decision "${id}"`);
      }
      const minimum = definition.confidence?.minimum;
      evaluation.decisions[id] = { ...result, accepted: minimum === undefined ||
        (result.confidence !== undefined && result.confidence >= minimum) };
    }
    const context = { input, decisions: evaluation.decisions };
    for (const [index, step] of plan.flow.entries()) {
      if (!step.expression || evaluateExpression(step.expression, context)) {
        this.options.onEvent?.({ type: 'flow:match', index });
        const output = interpolateValue(step.action.value, context);
        this.options.onEvent?.({ type: 'flow:return', value: output });
        return {
          process: plan.definition.process, output, decisions: evaluation.decisions,
          ...(evaluation.usage ? { usage: evaluation.usage } : {}),
          ...(evaluation.diagnostics ? { diagnostics: evaluation.diagnostics } : {}),
          timing: { totalMs: performance.now() - start, inferenceMs },
        };
      }
    }
    throw new RuntimeError(`No flow rule matched in process "${plan.definition.process}"; add an else rule`);
  }
}
