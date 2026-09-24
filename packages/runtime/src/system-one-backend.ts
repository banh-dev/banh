import type { SystemOneQuestion } from '@banh/dsl';
import type { DecisionResult } from './result.js';

/** One batch of normalized answers and optional token usage. */
export interface SystemOneEvaluation {
  decisions: Record<string, DecisionResult>;
  usage?: { inputTokens?: number };
}

/** Runtime boundary; implementations own model loading and resource cleanup. */
export interface SystemOneBackend {
  evaluate(state: unknown, questions: Record<string, SystemOneQuestion>): Promise<SystemOneEvaluation>;
  close(): Promise<void>;
}
