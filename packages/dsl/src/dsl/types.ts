/** JSON-compatible values accepted by return actions. */
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

/** Bounded semantic decisions supported by version 1 of the file format. */
export type DecisionDefinition = (
  | { decide: "one_of"; question: string; options: Record<string, string> }
  | { decide: "whether"; question: string }
  | { decide: "scale"; question: string; levels: string[] }
) & { confidence?: { minimum: number } | undefined };

export interface InputDefinition {
  type: "json" | "text";
}

export interface ReturnAction {
  do: "return";
  value: JsonValue;
}

export type FlowStep = (ReturnAction & { when: string }) | { else: ReturnAction };

/** A validated process definition; input defaults are left to the runtime. */
export interface ProcessFile {
  version: 1;
  process: string;
  input?: InputDefinition;
  decisions: Record<string, DecisionDefinition>;
  flow: FlowStep[];
}
