import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { DslParseError, DslValidationError } from '@banh/dsl';
import { parseProcess } from '@banh/dsl';
import { makeProcess, supportYaml } from "./helpers.js";

describe("parseProcess", () => {
  it("parses all three decision kinds and structured return values", () => {
    const process = makeProcess();
    expect(process.process).toBe("support_triage");
    expect(Object.keys(process.decisions)).toEqual(["department", "urgent", "severity"]);
    expect(process.flow[3]).toEqual({ else: { do: "return", value: { route: "support" } } });
  });

  it.each([
    ["version", { version: 2 }],
    ["missing process", { process: undefined }],
    ["empty process", { process: "  " }],
    ["unknown field", { typo: true }],
    ["empty decisions", { decisions: {} }],
    ["invalid decision kind", { decisions: { a: { decide: "chat", question: "Q?" } } }],
    ["one option", { decisions: { a: { decide: "one_of", question: "Q?", options: { only: "Only" } } } }],
    ["one level", { decisions: { a: { decide: "scale", question: "Q?", levels: ["low"] } } }],
    ["empty question", { decisions: { a: { decide: "whether", question: " " } } }],
    ["invalid identifier", { decisions: { "a.b": { decide: "whether", question: "Q?" } } }],
    ["empty flow", { flow: [] }],
    ["unsupported action", { flow: [{ else: { do: "shell", value: "ls" } }] }],
    ["missing return value", { flow: [{ else: { do: "return" } }] }],
    ["unknown decision", { flow: [{ when: "priority.value == true", do: "return", value: null }] }],
    ["unsupported property", { flow: [{ when: "urgent.raw == true", do: "return", value: null }] }],
    ["scale probability", { flow: [{ when: "severity.probability > 0.5", do: "return", value: null }] }],
    ["type mismatch", { flow: [{ when: 'urgent.value == "true"', do: "return", value: null }] }],
    ["string ordering", { flow: [{ when: 'department.value > "billing"', do: "return", value: null }] }],
    ["invalid input type", { input: { type: "xml" } }],
  ])("rejects %s", (_name, changes) => {
    expect(() => parseProcess(stringify({ ...makeProcess(), ...changes }))).toThrow(DslValidationError);
  });

  it("accepts optional input and explicit null output", () => {
    const process = makeProcess();
    delete process.input;
    process.flow = [{ else: { do: "return", value: null } }];
    expect(parseProcess(stringify(process))).toEqual(process);
  });

  it("reports the expression's YAML path", () => {
    expect(() => parseProcess(supportYaml.replace("urgent.probability", "priority.probability"))).toThrow(/flow\[0\].when: references unknown decision "priority"/);
  });

  it.each([
    "version: [",
    `${supportYaml}\nversion: 1`,
    supportYaml.replace("  urgent:\n", "  urgent: { decide: whether, question: Duplicate }\n  urgent:\n"),
    supportYaml.replace("      billing: Payments, refunds, invoices", "      billing: First\n      billing: Second"),
    `${supportYaml}\n---\nversion: 1`,
    supportYaml.replace("route: support", "route: !custom support"),
    supportYaml.replace("route: support", "1: support"),
    supportYaml.replace("route: support", "route: &cycle [*cycle]"),
  ])("rejects malformed, ambiguous, or unsupported YAML %#", source => {
    expect(() => parseProcess(source)).toThrow(DslParseError);
  });

  it("rejects misplaced and repeated else rules", () => {
    const process = makeProcess();
    const fallback = { else: { do: "return" as const, value: null } };
    process.flow = [fallback, ...process.flow];
    expect(() => parseProcess(stringify(process))).toThrow("else must be the last flow entry");
    // Avoid YAML aliases generated when serializing the same object twice.
    process.flow = [fallback, { else: { do: "return", value: false } }];
    expect(() => parseProcess(stringify(process))).toThrow("else may appear only once");
  });
});
