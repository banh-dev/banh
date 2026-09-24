import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { SystemOneBackend } from '@banh/runtime';
import type { LayaBackendOptions } from '@banh/laya';
import { parseProcess } from '@banh/dsl';
import { RuntimeError } from '@banh/dsl';
import { ProcessRuntime, validateInput } from '@banh/runtime';
import type { ProcessExecutionResult } from '@banh/runtime';

/** Testable command boundary; the default factory loads the real model lazily. */
export interface RunDependencies {
  createBackend?: (options: LayaBackendOptions) => Promise<SystemOneBackend>;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

function humanOutput(result: ProcessExecutionResult): string {
  const decisions = Object.entries(result.decisions).map(([id, result]) => [
    id, `  value        ${result.value}`,
    ...(result.probability === undefined ? [] : [`  probability  ${result.probability.toFixed(4)}`]),
    ...(result.confidence === undefined ? [] : [`  confidence   ${result.confidence.toFixed(4)}`]),
  ].join('\n')).join('\n\n');
  return `Process: ${result.process}\n\nDecisions\n\n${decisions}\n\nResult\n\n${JSON.stringify(result.output, null, 2)}\n\nInference: ${result.timing.inferenceMs?.toFixed(0)} ms\nTotal:     ${result.timing.totalMs.toFixed(0)} ms\nTokens:    ${result.usage?.inputTokens ?? 'unavailable'}`;
}

/** Run a workflow, always releasing model resources, and write one result. */
export async function runCommand(args: string[], dependencies: RunDependencies = {}): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    input: { type: 'string' }, text: { type: 'string' }, json: { type: 'boolean' }, verbose: { type: 'boolean' },
    'model-dir': { type: 'string' }, 'cache-dir': { type: 'string' }, revision: { type: 'string' },
  } });
  if (positionals.length !== 1 || (values.input === undefined) === (values.text === undefined)) {
    throw new RuntimeError('Usage: banh run <workflow.yaml> (--input <file> | --text <text>) [--json] [--verbose]');
  }
  const definition = parseProcess(await readFile(positionals[0]!, 'utf8'));
  let input: unknown = values.text;
  if (values.input !== undefined) {
    const source = await readFile(values.input, 'utf8');
    if (definition.input?.type === 'text') input = source;
    else {
      try { input = JSON.parse(source); }
      catch (cause) { throw new RuntimeError(`Invalid JSON input in "${values.input}"`, { cause }); }
    }
  } else if (definition.input?.type === 'json') {
    throw new RuntimeError('This workflow requires JSON input; use --input <file>');
  }
  validateInput(input, definition.input?.type);
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  const createBackend = dependencies.createBackend ?? (async (options: LayaBackendOptions) => {
    const { LayaBackend } = await import('@banh/laya');
    return LayaBackend.create(options);
  });
  const backend = await createBackend({
    ...(values['model-dir'] === undefined ? {} : { modelDir: values['model-dir'] }),
    ...(values['cache-dir'] === undefined ? {} : { cacheDir: values['cache-dir'] }),
    ...(values.revision === undefined ? {} : { revision: values.revision }),
  });
  let result: ProcessExecutionResult;
  let failed = false;
  try {
    const runtime = new ProcessRuntime(backend, values.verbose ? { onEvent: event => stderr(JSON.stringify(event)) } : {});
    result = await runtime.execute(definition, input);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try { await backend.close(); }
    catch (error) {
      if (!failed) throw error;
      stderr(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  stdout(values.json ? JSON.stringify(result, null, 2) : humanOutput(result));
}
