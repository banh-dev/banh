import { readFile, rm } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { compileProcess, parseProcess } from '@banh/dsl';
import { formatRuns, formatInspection } from './history.js';
import { CloudClient } from './client.js';
import { configPath, DEFAULT_API_URL, envValue, normalizeApiUrl, readConfig, resolveConnection, saveConfig } from './config.js';
import type { Environment } from './config.js';
import { deviceLogin, discoverAuth0 } from './auth0.js';
import type { DeviceLoginDependencies } from './auth0.js';

export interface CloudDependencies {
  env?: Environment;
  configFile?: string;
  fetch?: typeof fetch;
  device?: DeviceLoginDependencies;
  stdout?: (message: string) => void;
}

/** Cloud commands share configuration, but local validate/run never use it. */
export async function cloudCommand(command: 'login' | 'logout' | 'whoami' | 'deploy' | 'invoke' | 'runs' | 'inspect' | 'billing', args: string[], dependencies: CloudDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const path = dependencies.configFile ?? configPath(env);
  const stdout = dependencies.stdout ?? console.log;
  const options: NonNullable<ParseArgsConfig['options']> = command === 'logout' ? {} : {
    ...(command === 'runs' ? { limit: { type: 'string' as const }, offset: { type: 'string' as const } } : {}),
    ...(command === 'invoke' ? { input: { type: 'string' as const }, text: { type: 'string' as const } } : {}),
    'api-url': { type: 'string' as const }, ...(command === 'login' ? { 'no-browser': { type: 'boolean' as const } } : { json: { type: 'boolean' as const } }),
  };
  const { values, positionals } = parseArgs({ args, options, strict: true, allowPositionals: true });
  const positional = command === 'deploy' ? ' <workflow.yaml>' : command === 'inspect' ? ' <run-id>' : ['invoke', 'runs'].includes(command) ? ' <workflow>' : '';
  if (command !== 'billing' && positionals.length !== (positional ? 1 : 0)) throw new Error(`Usage: banh ${command}${positional}`);
  const pageNumber = (value: unknown, fallback: number, min: number, max: number, name: string) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
    return Number(value);
  };
  const limit = pageNumber(values.limit, 50, 1, 100, '--limit');
  const offset = pageNumber(values.offset, 0, 0, 10000, '--offset');
  if (command === 'runs' && !/^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(positionals[0]!)) throw new Error('Invalid workflow name');
  if (command === 'inspect' && !/^run_[a-zA-Z0-9]+$/.test(positionals[0]!)) throw new Error('Invalid run ID');
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
  let invocationInput: unknown;
  if (command === 'invoke') {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(positionals[0]!) ||
        (values.input === undefined) === (values.text === undefined)) {
      throw new Error('Usage: banh invoke <workflow> (--input <json-file> | --text <text>) [--json]');
    }
    invocationInput = values.text;
    if (typeof values.input === 'string') {
      try { invocationInput = JSON.parse(await readFile(values.input, 'utf8')); }
      catch { throw new Error('Unable to read JSON input file'); }
    }
  }
  if (command === 'billing') {
    const action = positionals[0] ?? 'status';
    const needsPlan = action === 'checkout' || action === 'plan';
    if (!['status', 'checkout', 'portal', 'plan'].includes(action) ||
        positionals.length > (needsPlan ? 2 : 1) || (needsPlan && !['starter','pro'].includes(positionals[1] ?? ''))) {
      throw new Error('Usage: banh billing [status | checkout <starter|pro> | plan <starter|pro> | portal] [--json]');
    }
  }
  const saved = await readConfig(path);
  const override = typeof values['api-url'] === 'string' ? values['api-url'] : undefined;
  if (command === 'login') {
    const apiUrl = normalizeApiUrl(override ?? envValue(env, 'API_URL') ?? saved?.apiUrl ?? DEFAULT_API_URL);
    let token = envValue(env, 'API_TOKEN')?.trim();
    let expiresAt: number | undefined;
    if (!token) {
      const settings = await discoverAuth0(apiUrl, dependencies.fetch);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once('SIGINT', cancel);
      try {
        const grant = await deviceLogin(settings, {
          ...dependencies.device, ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}), stdout,
          signal: controller.signal, noBrowser: values['no-browser'] === true,
        });
        token = grant.token;
        expiresAt = grant.expiresAt;
      } finally { process.removeListener('SIGINT', cancel); }
    }
    const identity = await new CloudClient({ apiUrl, token }, dependencies.fetch).whoami(envValue(env, 'ACCOUNT_ID'));
    const accountId = envValue(env, 'ACCOUNT_ID');
    if (accountId && accountId !== identity.account.id) throw new Error('Configured account does not match this Auth0 access token');
    await saveConfig(path, { apiUrl, token, accountId: identity.account.id, ...(expiresAt === undefined ? {} : { expiresAt }) });
    stdout(`Logged in as ${identity.user.email ?? identity.user.id}\nAccount: ${identity.account.name} (${identity.account.id})\nAPI: ${apiUrl}`);
    return;
  }
  const connection = resolveConnection(env, saved, override);
  const client = new CloudClient(connection, dependencies.fetch);
  if (command === 'invoke') {
    // Invocation keys cannot call /me; use an explicitly configured account.
    const accountId = connection.accountId ?? (await client.whoami()).account.id;
    const result = await client.invoke(accountId, positionals[0]!, invocationInput);
    stdout(values.json ? JSON.stringify(result, null, 2) : `${result.workflow} v${result.version} — ${result.status}\nRun: ${result.id}\n\n${JSON.stringify(result.output, null, 2)}`);
    if (result.status !== 'completed') throw new Error(`Run ${result.id} failed (${result.error?.code ?? result.status})`);
    return;
  }
  const identity = await client.whoami(connection.accountId);
  if (connection.accountId && connection.accountId !== identity.account.id) throw new Error('Configured account does not match this Auth0 access token');
  if (command === 'billing') {
    const action = (positionals[0] ?? 'status') as 'status' | 'checkout' | 'portal' | 'plan';
    const result = await client.billing(identity.account.id, action, positionals[1]);
    stdout(values.json ? JSON.stringify(result, null, 2) : 'url' in result ? `Open ${result.url}` :
      `Plan: ${result.plan ?? 'none'}\nStatus: ${result.status}\nRuns: ${result.used} used, ${result.reserved} reserved, ${result.remaining} remaining of ${result.limit}\nPeriod ends: ${result.periodEnd ?? '—'}\nCancels at period end: ${result.cancelAtPeriodEnd ? 'yes' : 'no'}`);
    return;
  }
  if (command === 'runs') {
    const result = await client.runs(identity.account.id, positionals[0]!, limit, offset);
    stdout(values.json ? JSON.stringify(result, null, 2) : formatRuns(positionals[0]!, result.runs));
    return;
  }
  if (command === 'inspect') {
    const result = await client.inspect(identity.account.id, positionals[0]!);
    stdout(values.json ? JSON.stringify(result, null, 2) : formatInspection(result));
    return;
  }
  if (command === 'whoami') {
    stdout(values.json ? JSON.stringify(identity, null, 2) : `${identity.user.email ?? identity.user.id}\nAccount: ${identity.account.name} (${identity.account.id})\nAPI: ${connection.apiUrl}`);
    return;
  }
  if (!deployment) throw new Error('Missing workflow');
  const result = await client.deploy(identity.account.id, deployment.definition.process, deployment.sourceYaml, deployment.compiled);
  stdout(values.json ? JSON.stringify(result, null, 2) : `✓ validated\n✓ compiled\n✓ uploaded\n\n${result.workflow} v${result.version} deployed\n\n${result.invokeUrl}`);
}
