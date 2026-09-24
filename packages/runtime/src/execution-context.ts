import type { DecisionResult } from "./result.js";

/** State available to deterministic flow evaluation. */
export interface ExecutionContext {
  input: unknown;
  decisions: Record<string, DecisionResult>;
}
