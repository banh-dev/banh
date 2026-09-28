import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { SystemOneBackend } from '@banh-dev/runtime';
import { createProvider } from '@banh-dev/providers';
import type { ProviderOptions } from '@banh-dev/providers';
import { parseProcess } from '@banh-dev/dsl';
import { RuntimeError } from '@banh-dev/dsl';
import { ProcessRuntime, validateInput } from '@banh-dev/runtime';
import type { ProcessExecutionResult } from '@banh-dev/runtime';

/** Testable command boundary; the default factory loads the real model lazily. */
export interface RunDependencies {
  createBackend?: (options: ProviderOptions) => Promise<SystemOneBackend>;
  env?: NodeJS.ProcessEnv;
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
    provider: { type: 'string' }, model: { type: 'string' },
    'model-id': { type: 'string' },
    'base-url': { type: 'string' }, 'timeout-ms': { type: 'string' },
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
  const env = dependencies.env ?? process.env;
  const provider = values.provider ?? env.BANH_PROVIDER ?? (definition.model && definition.model.provider !== 'laya' ? 'http' : 'native');
  const model = values.model ?? env.BANH_MODEL ?? definition.model?.provider ?? 'laya';
  if (model !== 'laya' && model !== 'kev' && model !== 'jev') throw new RuntimeError('Unsupported model; use laya, kev, or jev');
  if (provider !== 'native' && provider !== 'http') throw new RuntimeError('Unsupported provider; use native or http');
  if (definition.model && !values.model && !env.BANH_MODEL) {
    const supported = { laya: 'laya', kev: 'kev-4b', jev: 'jev-latest' };
    if (definition.model.model !== supported[model]) throw new RuntimeError('Unsupported logical model for local execution');
  }
  let config: ProviderOptions;
  if (provider === 'http') {
    if (values['model-dir'] !== undefined || values['cache-dir'] !== undefined || values.revision !== undefined) {
      throw new RuntimeError('--model-dir, --cache-dir, and --revision require the native provider');
    }
    const baseUrl = values['base-url'] ?? env.BANH_INFERENCE_BASE_URL;
    const modelId = values['model-id'] ?? env.BANH_INFERENCE_MODEL_ID;
    const timeout = values['timeout-ms'] ?? env.BANH_INFERENCE_TIMEOUT_MS;
    const token = env.BANH_INFERENCE_TOKEN;
    if (!baseUrl && model !== 'jev') throw new RuntimeError('HTTP provider requires --base-url or BANH_INFERENCE_BASE_URL for ' + model);
    if (model === 'jev' && !token) throw new RuntimeError('Jev requires an inference bearer token (BANH_INFERENCE_TOKEN)');
    config = { provider, model, options: {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(modelId === undefined ? {} : { modelId }),
      ...(token === undefined ? {} : { token }),
      ...(timeout === undefined ? {} : { timeoutMs: Number(timeout) }),
    } };
  } else {
    if (model !== 'laya') throw new RuntimeError('Native execution supports only laya; use the http provider for kev or jev');
    if (values['model-id'] !== undefined) throw new RuntimeError('--model-id requires the http provider');
    if (values['base-url'] !== undefined || values['timeout-ms'] !== undefined) {
      throw new RuntimeError('--base-url and --timeout-ms require the http provider');
    }
    config = { provider, model, options: {
      ...(values['model-dir'] === undefined ? {} : { modelDir: values['model-dir'] }),
      ...(values['cache-dir'] === undefined ? {} : { cacheDir: values['cache-dir'] }),
      ...(values.revision === undefined ? {} : { revision: values.revision }),
    } };
  }
  const backend = await (dependencies.createBackend ?? createProvider)(config);
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
