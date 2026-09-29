import type { SystemOneQuestion } from '@banh/dsl';
import type { DecisionResult } from './result.js';

export interface ProviderDiagnostics {
  attemptCount: number;
  latencyMs: number;
  requestBytes: number;
  responseStatus?: number;
  upstreamModel?: string;
}
export interface ProviderExecutionOptions {
  signal?: AbortSignal;
  onDiagnostics?: (diagnostics: ProviderDiagnostics) => void;
}

/** One batch of normalized answers and optional token usage. */
export interface SystemOneEvaluation {
  decisions: Record<string, DecisionResult>;
  usage?: { inputTokens?: number; outputTokens?: number };
  diagnostics?: ProviderDiagnostics;
}

/** Runtime boundary; implementations own model loading and resource cleanup. */
export interface SystemOneBackend {
  evaluate(state: unknown, questions: Record<string, SystemOneQuestion>, options?: ProviderExecutionOptions): Promise<SystemOneEvaluation>;
  close(): Promise<void>;
}
