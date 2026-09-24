import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

function run(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/index.ts", ...args], { encoding: "utf8" });
}

it.each(["support-triage", "warranty-claim"])("validates %s from the CLI", name => {
  const result = run("validate", `examples/${name}.yaml`);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Process is valid.");
  expect(result.stderr).toBe("");
});

it("reports missing files without a stack trace", () => {
  const result = run("validate", "missing.yaml");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("ENOENT");
  expect(result.stderr).not.toContain("at ");
  expect(result.stdout).toBe("");
});

it("rejects unsupported commands and extra arguments", () => {
  expect(run("run", "examples/support-triage.yaml").status).toBe(1);
  expect(run("validate", "examples/support-triage.yaml", "--typo").status).toBe(1);
  expect(run("--help").status).toBe(0);
});
