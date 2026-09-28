import { describe, expect, it } from "vitest";
import { parseExpression, validateExpression } from '@banh-dev/dsl';
import { ExpressionEvaluationError, ExpressionParseError } from '@banh-dev/dsl';
import { evaluateExpression } from '@banh-dev/runtime';
import type { ExecutionContext } from '@banh-dev/runtime';
import { makeProcess } from "./helpers.js";

const context: ExecutionContext = {
  input: {},
  decisions: {
    department: { id: "department", kind: "one_of", value: "billing", raw: null },
    urgent: { id: "urgent", kind: "whether", value: true, probability: 0.85, confidence: 0.7, raw: null },
    severity: { id: "severity", kind: "scale", value: 2.6, raw: null },
  },
};

describe("expression grammar and evaluation", () => {
  it.each([
    ['department.value == "billing"', true],
    ['department.value != "billing"', false],
    ['department.value == "support"', false],
    ["urgent.value == true", true],
    ["urgent.value == false", false],
    ["urgent.probability >= 0.85", true],
    ["urgent.probability > 0.85", false],
    ["urgent.probability <= 0.85", true],
    ["urgent.probability < 0.85", false],
    ["urgent.confidence != 0.8", true],
    ["severity.value >= 2", true],
    ["severity.value < -2e1", false],
    ["  severity.value>=2.6  ", true],
  ])("evaluates %s", (source, expected) => {
    const expression = parseExpression(source);
    validateExpression(expression, makeProcess().decisions);
    expect(evaluateExpression(expression, context)).toBe(expected);
  });

  it("supports JSON string escapes", () => {
    expect(parseExpression('department.value == "bill\\u0069ng"').literal).toBe("billing");
    expect(parseExpression('department.value == "say \\"hi\\""').literal).toBe('say "hi"');
  });

  it.each([
    'department.value === "billing"', 'department.value = "billing"',
    "urgent.value == null", "urgent.value == True", "urgent.value == true && urgent.value == false",
    "urgent.value == true || urgent.value == false", "!urgent.value", "(urgent.value == true)",
    "severity.value > 1 + 1", "severity.value > Infinity", "severity.value > NaN", "severity.value > 1e999",
    "severity.value > 01", "severity.value > .5", "urgent.raw == true", "urgent.value.foo == true",
    'department.value == "unterminated', "department.value == 'billing'", 'department.value == "bad\\q"',
    "urgent.value == globalThis.process.exit()", "urgent.value == true; process.exit()",
  ])("rejects unsupported syntax: %s", source => {
    expect(() => parseExpression(source)).toThrow(ExpressionParseError);
  });

  it("rejects unknown and inherited decision names", () => {
    for (const id of ["missing", "toString", "constructor"]) {
      const expression = parseExpression(`${id}.value == true`);
      expect(() => validateExpression(expression, makeProcess().decisions)).toThrow("unknown decision");
      expect(() => evaluateExpression(expression, context)).toThrow(ExpressionEvaluationError);
    }
  });

  it("reports unavailable optional metadata instead of silently matching", () => {
    expect(() => evaluateExpression(parseExpression("department.confidence != 0.5"), context)).toThrow("unavailable");
  });

  it("does not coerce strings and booleans", () => {
    expect(() => evaluateExpression(parseExpression('urgent.value == "true"'), context)).toThrow("Incompatible operands");
    expect(() => evaluateExpression(parseExpression('department.value > "a"'), context)).toThrow("numeric operands");
  });
});
