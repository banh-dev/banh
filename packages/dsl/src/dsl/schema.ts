import { z } from "zod";
import { decisionIdPattern, parseExpression, validateExpression } from "./expressions.js";
import type { JsonValue } from "./types.js";
import { validateTemplates } from './templates.js';

const nonEmptyString = z.string().refine(value => value.trim().length > 0, "Must not be empty");
const identifier = z.string().regex(decisionIdPattern, "Use an identifier such as department or valid_claim");
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.string(), z.number(), z.boolean(), z.array(jsonValue), z.record(z.string(), jsonValue),
]));

const confidence = z.strictObject({ minimum: z.number().min(0).max(1) }).optional();
export const decisionSchema = z.discriminatedUnion("decide", [
  z.strictObject({
    decide: z.literal("one_of"), question: nonEmptyString, confidence,
    options: z.record(nonEmptyString, nonEmptyString).refine(value => Object.keys(value).length >= 2, "one_of requires at least 2 options"),
  }),
  z.strictObject({ decide: z.literal("whether"), question: nonEmptyString, confidence }),
  z.strictObject({ decide: z.literal("scale"), question: nonEmptyString, levels: z.array(nonEmptyString).min(2), confidence }),
]);

const returnShape = { do: z.literal("return"), value: jsonValue };
const flowStepSchema = z.union([
  z.strictObject({ when: nonEmptyString, ...returnShape }),
  z.strictObject({ else: z.strictObject(returnShape) }),
]);

/** Strict structural and semantic validation, without a model dependency. */
export const processSchema = z.strictObject({
  version: z.literal(1),
  process: nonEmptyString,
  input: z.strictObject({ type: z.enum(["json", "text"]) }).optional(),
  decisions: z.record(identifier, decisionSchema).refine(value => Object.keys(value).length > 0, "At least one decision is required"),
  flow: z.array(flowStepSchema).min(1),
}).superRefine((process, context) => {
  let elseSeen = false;
  process.flow.forEach((step, index) => {
    const action = 'else' in step ? step.else : step;
    validateTemplates(action.value, process.decisions, (path, message) => {
      context.addIssue({ code: 'custom', path: ['flow', index, ...('else' in step ? ['else'] : []), 'value', ...path], message });
    });
    if ("else" in step) {
      if (elseSeen) context.addIssue({ code: "custom", path: ["flow", index, "else"], message: "else may appear only once" });
      if (index !== process.flow.length - 1) context.addIssue({ code: "custom", path: ["flow", index, "else"], message: "else must be the last flow entry" });
      elseSeen = true;
    } else {
      try {
        validateExpression(parseExpression(step.when), process.decisions);
      } catch (error) {
        context.addIssue({ code: "custom", path: ["flow", index, "when"], message: error instanceof Error ? error.message : String(error) });
      }
    }
  });
});
