import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Environment = Record<string, string | undefined>;
export interface SavedConfig { apiUrl: string; token: string; accountId: string }
export const DEFAULT_API_URL = 'http://127.0.0.1:3000';
export const envValue = (env: Environment, key: 'API_URL' | 'API_TOKEN' | 'ACCOUNT_ID') => env[`BANH_${key}`] ?? env[`banh_${key}`];

/** Canonical API root; permit cleartext only on loopback for local development. */
export function normalizeApiUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid API URL'); }
  if (url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('API URL must be an origin, optionally ending in /v1, without credentials, query, or fragment');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('API URL must use HTTPS, or HTTP on localhost for local development');
  }
  return url.origin;
}

export function configPath(env: Environment = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (env.BANH_CONFIG_DIR) return join(env.BANH_CONFIG_DIR, 'config.json');
  const root = platform === 'win32' ? env.APPDATA ?? join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(root, 'banh', 'config.json');
}

export async function readConfig(path: string): Promise<SavedConfig | undefined> {
  let source: string;
  try { source = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('Unable to read Banh configuration');
  }
  try {
    const value = JSON.parse(source) as Partial<SavedConfig>;
    if (!value || typeof value.apiUrl !== 'string' || typeof value.token !== 'string' || typeof value.accountId !== 'string' || !value.token || !/^acct_[a-zA-Z0-9]+$/.test(value.accountId)) throw new Error();
    return { apiUrl: normalizeApiUrl(value.apiUrl), token: value.token, accountId: value.accountId };
  } catch { throw new Error('Invalid Banh configuration. Run banh logout, then banh login to replace it.'); }
}

/** Atomic replacement keeps existing credentials intact if a write fails. */
export async function saveConfig(path: string, config: SavedConfig): Promise<void> {
  const directory = dirname(path);
  const temporary = join(directory, `.config-${randomUUID()}.tmp`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } catch { throw new Error('Unable to save Banh credentials'); }
  finally { await rm(temporary, { force: true }); }
}

export function resolveConnection(env: Environment, saved?: SavedConfig, apiOverride?: string) {
  const apiUrl = normalizeApiUrl(apiOverride ?? envValue(env, 'API_URL') ?? saved?.apiUrl ?? DEFAULT_API_URL);
  const environmentToken = envValue(env, 'API_TOKEN');
  const sameServer = saved?.apiUrl === apiUrl;
  const token = environmentToken ?? (sameServer ? saved?.token : undefined);
  const accountId = envValue(env, 'ACCOUNT_ID') ?? (environmentToken === undefined && sameServer ? saved?.accountId : undefined);
  if (!token) throw new Error('No credentials for this API URL. Run banh login or set BANH_API_TOKEN.');
  return { apiUrl, token, accountId };
}
