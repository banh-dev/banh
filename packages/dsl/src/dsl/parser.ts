import { isMap, isScalar, parseDocument, visit } from "yaml";
import { DslParseError, DslValidationError } from "./errors.js";
import { processSchema } from "./schema.js";
import type { ProcessFile } from "./types.js";

/** Validate an external process object, including flow references. */
export function validateProcess(value: unknown): ProcessFile {
  const result = processSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues.map(issue => {
      const path = issue.path.reduce<string>((path, part) => typeof part === "number" ? `${path}[${part}]` : `${path}${path ? "." : ""}${String(part)}`, "");
      return `${path || "workflow"}: ${issue.message}`;
    });
    throw new DslValidationError(`Invalid workflow:\n\n${issues.join("\n")}`);
  }
  // Omit absent input instead of emitting an explicit undefined property.
  const { input, ...process } = result.data;
  return input ? { ...process, input } : process;
}

/** Parse one YAML document without silently converting malformed map keys. */
export function parseProcess(source: string): ProcessFile {
  let value: unknown;
  try {
    const document = parseDocument(source, { uniqueKeys: true, strict: true });
    const errors = [...document.errors, ...document.warnings];
    if (errors.length) throw new DslParseError(errors.map(error => error.message).join("\n"));
    visit(document, (_key, node) => {
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
            throw new DslParseError("YAML mapping keys must be strings");
          }
        }
      }
    });
    // Aliases are outside the minimal DSL; disallow them to exclude cyclic input.
    value = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof DslParseError) throw error;
    throw new DslParseError(`Unable to parse YAML: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return validateProcess(value);
}
