import { readFile, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { compileProcess, parseProcess } from '@banh/dsl';
import { CloudClient } from './client.js';
import { configPath, DEFAULT_API_URL, envValue, normalizeApiUrl, readConfig, resolveConnection, saveConfig } from './config.js';
import type { Environment } from './config.js';
import { promptToken } from './prompt.js';

export interface CloudDependencies {
  env?: Environment;
  configFile?: string;
  fetch?: typeof fetch;
  promptToken?: () => Promise<string>;
  stdout?: (message: string) => void;
}

/** Cloud commands share configuration, but local validate/run never use it. */
export async function cloudCommand(command: 'login' | 'logout' | 'whoami' | 'deploy', args: string[], dependencies: CloudDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const path = dependencies.configFile ?? configPath(env);
  const stdout = dependencies.stdout ?? console.log;
  const options: NonNullable<ParseArgsConfig['options']> = command === 'logout' ? {} : {
    'api-url': { type: 'string' as const }, ...(command === 'login' ? {} : { json: { type: 'boolean' as const } }),
  };
  const { values, positionals } = parseArgs({ args, options, strict: true, allowPositionals: true });
  if (positionals.length !== (command === 'deploy' ? 1 : 0)) throw new Error(`Usage: banh ${command}${command === 'deploy' ? ' <workflow.yaml>' : ''}`);
  if (command === 'logout') {
    await rm(path, { force: true });
    stdout('Logged out. Saved credentials removed.');
    if (envValue(env, 'API_TOKEN')) stdout('An API token is still set in the environment; unset it to stop using environment credentials.');
    return;
  }
  // Parse and compile before reading credentials or making any network requests.
  let deployment;
  if (command === 'deploy') {
    const sourceYaml = await readFile(positionals[0]!, 'utf8');
    if (Buffer.byteLength(sourceYaml, 'utf8') > 65_536) throw new Error('Workflow exceeds the cloud limit of 64 KiB');
    const definition = parseProcess(sourceYaml);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(definition.process)) throw new Error('Cloud workflow names must be identifiers of at most 120 characters');
    deployment = { sourceYaml, definition, compiled: compileProcess(definition) };
  }
  const saved = await readConfig(path);
  const override = typeof values['api-url'] === 'string' ? values['api-url'] : undefined;
  if (command === 'login') {
    const apiUrl = normalizeApiUrl(override ?? envValue(env, 'API_URL') ?? saved?.apiUrl ?? DEFAULT_API_URL);
    const token = (envValue(env, 'API_TOKEN') ?? await (dependencies.promptToken ?? promptToken)()).trim();
    if (!token) throw new Error('A developer token is required');
    const identity = await new CloudClient({ apiUrl, token }, dependencies.fetch).whoami();
    const accountId = envValue(env, 'ACCOUNT_ID');
    if (accountId && accountId !== identity.account.id) throw new Error('Configured account does not match this developer token');
    await saveConfig(path, { apiUrl, token, accountId: identity.account.id });
    stdout(`Logged in as ${identity.user.email}\nAccount: ${identity.account.name} (${identity.account.id})\nAPI: ${apiUrl}`);
    return;
  }
  const connection = resolveConnection(env, saved, override);
  const client = new CloudClient(connection, dependencies.fetch);
  const identity = await client.whoami();
  if (connection.accountId && connection.accountId !== identity.account.id) throw new Error('Configured account does not match this developer token');
  if (command === 'whoami') {
    stdout(values.json ? JSON.stringify(identity, null, 2) : `${identity.user.email}\nAccount: ${identity.account.name} (${identity.account.id})\nAPI: ${connection.apiUrl}`);
    return;
  }
  if (!deployment) throw new Error('Missing workflow');
  const result = await client.deploy(identity.account.id, deployment.definition.process, deployment.sourceYaml, deployment.compiled);
  stdout(values.json ? JSON.stringify(result, null, 2) : `✓ validated\n✓ compiled\n✓ uploaded\n\n${result.workflow} v${result.version} deployed\n\n${result.invokeUrl}`);
}
