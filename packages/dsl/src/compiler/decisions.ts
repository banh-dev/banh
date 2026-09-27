import type { DecisionDefinition } from "../dsl/types.js";

/** Provider-neutral questions; the compiler never imports an inference SDK. */
export type SystemOneQuestion =
  | { type: "one_of"; question: string; options: Record<string, string> }
  | { type: "whether"; question: string }
  | { type: "scale"; question: string; levels: string[] };

/** Compile all decisions into a single map for one batched evaluation. */
export function compileDecisions(decisions: Record<string, DecisionDefinition>): Record<string, SystemOneQuestion> {
  return Object.fromEntries(Object.entries(decisions).map(([id, decision]) => {
    const prompt = decision.question;
    let question: SystemOneQuestion;
    switch (decision.decide) {
      case "one_of": question = { type: "one_of", question: prompt, options: { ...decision.options } }; break;
      case "whether": question = { type: "whether", question: prompt }; break;
      case "scale": question = { type: "scale", question: prompt, levels: [...decision.levels] }; break;
    }
    return [id, question];
  }));
}
