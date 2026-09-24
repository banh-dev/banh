import type { DecisionDefinition } from "../dsl/types.js";

/** Provider-neutral questions; the compiler never imports an inference SDK. */
export type SystemOneQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

/** Compile all decisions into a single map for one batched evaluation. */
export function compileDecisions(decisions: Record<string, DecisionDefinition>): Record<string, SystemOneQuestion> {
  return Object.fromEntries(Object.entries(decisions).map(([id, decision]) => {
    const instructions = decision.question;
    let question: SystemOneQuestion;
    switch (decision.decide) {
      case "one_of": question = { type: "choice", instructions, criteria: { ...decision.options } }; break;
      case "whether": question = { type: "noul", instructions }; break;
      case "scale": question = { type: "score", instructions, criteria: [...decision.levels] }; break;
    }
    return [id, question];
  }));
}
