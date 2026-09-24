/** Normalized model answer. Optional metadata may be absent from a backend. */
export interface DecisionResult {
  id: string;
  kind: "one_of" | "whether" | "scale";
  value: string | boolean | number;
  probability?: number;
  confidence?: number;
  /** Policy outcome assigned by the runtime; true when no policy is configured. */
  accepted?: boolean;
  probabilities?: Record<string, number>;
  raw: unknown;
}

/** Complete execution output, including the evidence used by the flow. */
export interface ProcessExecutionResult {
  process: string;
  output: unknown;
  decisions: Record<string, DecisionResult>;
  usage?: { inputTokens?: number };
  timing: { totalMs: number; inferenceMs?: number };
}
