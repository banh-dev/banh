import { readFileSync } from "node:fs";
import { parseProcess } from '@banh/dsl';

export const supportYaml = readFileSync(new URL("../examples/support-triage.yaml", import.meta.url), "utf8");
export const makeProcess = () => parseProcess(supportYaml);
