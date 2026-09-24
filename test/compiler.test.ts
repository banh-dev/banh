import { expect, it } from "vitest";
import { compileDecisions } from '@banh/dsl';
import { makeProcess } from "./helpers.js";

it("compiles all decision primitives into one question map", () => {
  const { decisions } = makeProcess();
  expect(compileDecisions(decisions)).toEqual({
    department: {
      type: "choice", instructions: decisions.department!.question,
      criteria: { billing: "Payments, refunds, invoices", support: "Product problems and bugs", sales: "New purchases" },
    },
    urgent: { type: "noul", instructions: decisions.urgent!.question },
    severity: { type: "score", instructions: decisions.severity!.question, criteria: ["negligible", "minor", "significant", "critical"] },
  });
});

it("does not share mutable criteria with the input definition", () => {
  const process = makeProcess();
  const questions = compileDecisions(process.decisions);
  if (questions.department!.type === "choice") questions.department!.criteria.billing = "Changed";
  if (questions.severity!.type === "score") questions.severity!.criteria.push("Changed");
  expect(process).toEqual(makeProcess());
});
