import { expect, it } from "vitest";
import { compileDecisions } from '@banh/dsl';
import { makeProcess } from "./helpers.js";

it("compiles all decision primitives into one question map", () => {
  const { decisions } = makeProcess();
  expect(compileDecisions(decisions)).toEqual({
    department: {
      type: "one_of", question: decisions.department!.question,
      options: { billing: "Payments, refunds, invoices", support: "Product problems and bugs", sales: "New purchases" },
    },
    urgent: { type: "whether", question: decisions.urgent!.question },
    severity: { type: "scale", question: decisions.severity!.question, levels: ["negligible", "minor", "significant", "critical"] },
  });
});

it("does not share mutable criteria with the input definition", () => {
  const process = makeProcess();
  const questions = compileDecisions(process.decisions);
  if (questions.department!.type === "one_of") questions.department!.options.billing = "Changed";
  if (questions.severity!.type === "scale") questions.severity!.levels.push("Changed");
  expect(process).toEqual(makeProcess());
});
