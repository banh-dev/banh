import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';

export interface Auth0Settings { issuer: string; clientId: string; audience: string }
export interface DeviceLoginDependencies {
  fetch?: typeof fetch;
  stdout?: (message: string) => void;
  openBrowser?: (url: string) => Promise<void>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  noBrowser?: boolean;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseAuth0Settings(value: unknown): Auth0Settings {
  if (!record(value) || typeof value.issuer !== 'string' || typeof value.clientId !== 'string' || !value.clientId || typeof value.audience !== 'string' || !value.audience) throw new Error('Invalid Auth0 configuration from Banh Cloud');
  let issuer: URL;
  try { issuer = new URL(value.issuer); } catch { throw new Error('Invalid Auth0 issuer'); }
  if (issuer.protocol !== 'https:' || issuer.pathname !== '/' || issuer.username || issuer.password || issuer.search || issuer.hash) throw new Error('Auth0 issuer must be an HTTPS origin');
  return { issuer: issuer.href, clientId: value.clientId, audience: value.audience };
}

async function jsonRequest(url: string, fetcher: typeof fetch, options: RequestInit, signal?: AbortSignal, timeoutMs = 10_000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: controller.signal });
    const value: unknown = await response.json();
    if (!record(value)) throw new Error('Invalid response');
    return { response, value };
  } catch {
    if (signal?.aborted) throw new Error('Login cancelled');
    throw new Error('Unable to complete Auth0 login request. Check connectivity and Auth0 configuration.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function discoverAuth0(apiUrl: string, fetcher: typeof fetch = fetch): Promise<Auth0Settings> {
  const { response, value } = await jsonRequest(`${apiUrl}/v1/auth/config`, fetcher, { method: 'GET' });
  if (!response.ok) throw new Error('Auth0 login is unavailable. Configure Auth0 in banh-cloud first.');
  return parseAuth0Settings(value);
}

export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** OAuth device authorization; no client secret, password, ID token, or refresh token. */
export async function deviceLogin(settings: Auth0Settings, dependencies: DeviceLoginDependencies = {}) {
  const config = parseAuth0Settings(settings);
  const fetcher = dependencies.fetch ?? fetch;
  const stdout = dependencies.stdout ?? console.log;
  const sleep = dependencies.sleep ?? (async (milliseconds, signal) => { await delay(milliseconds, undefined, signal ? { signal } : {}); });
  const now = dependencies.now ?? Date.now;
  const form = (body: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const { response, value } = await jsonRequest(`${config.issuer}oauth/device/code`, fetcher, form({ client_id: config.clientId, audience: config.audience, scope: 'openid profile email' }), dependencies.signal);
  if (!response.ok) throw new Error('Auth0 rejected device login. Check the Native application and Device Code grant configuration.');
  if (typeof value.device_code !== 'string' || !value.device_code || typeof value.user_code !== 'string' || !/^[A-Za-z0-9-]+$/.test(value.user_code) ||
    typeof value.verification_uri !== 'string' || typeof value.expires_in !== 'number' || !Number.isInteger(value.expires_in) || value.expires_in <= 0 || value.expires_in > 3600 ||
    (value.interval !== undefined && (typeof value.interval !== 'number' || !Number.isInteger(value.interval) || value.interval < 1 || value.interval > 60))) throw new Error('Invalid Auth0 device response');
  let verification: URL;
  let complete: URL;
  try {
    verification = new URL(value.verification_uri);
    complete = new URL(typeof value.verification_uri_complete === 'string' ? value.verification_uri_complete : value.verification_uri);
  } catch { throw new Error('Invalid Auth0 verification URL'); }
  for (const url of [verification, complete]) {
    if (url.origin !== new URL(config.issuer).origin || url.username || url.password || url.hash) throw new Error('Auth0 verification URL does not match the configured issuer');
  }
  const expiresAt = now() + value.expires_in * 1000;
  let interval = typeof value.interval === 'number' ? value.interval : 5;
  stdout(`Open ${verification.href}\nEnter code: ${value.user_code}\nWaiting for Auth0 authorization…`);
  if (!dependencies.noBrowser) {
    try { await (dependencies.openBrowser ?? openBrowser)(complete.href); }
    catch { stdout('Could not open a browser. Open the URL above manually.'); }
  }
  while (now() < expiresAt) {
    try { await sleep(Math.min(interval * 1000, expiresAt - now()), dependencies.signal); }
    catch { throw new Error('Login cancelled'); }
    if (dependencies.signal?.aborted) throw new Error('Login cancelled');
    if (now() >= expiresAt) break;
    const result = await jsonRequest(`${config.issuer}oauth/token`, fetcher, form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: value.device_code, client_id: config.clientId }), dependencies.signal, Math.min(10_000, expiresAt - now()));
    if (result.response.ok) {
      const token = result.value;
      if (typeof token.access_token !== 'string' || !token.access_token || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer' ||
        typeof token.expires_in !== 'number' || !Number.isSafeInteger(token.expires_in) || token.expires_in <= 0 || token.expires_in > 31_536_000) throw new Error('Invalid Auth0 token response');
      return { token: token.access_token, expiresAt: now() + token.expires_in * 1000 };
    }
    if (result.value.error === 'authorization_pending') continue;
    if (result.value.error === 'slow_down') { interval += 5; continue; }
    if (result.value.error === 'access_denied') throw new Error('Auth0 login was denied');
    if (result.value.error === 'expired_token') break;
    throw new Error('Auth0 login failed. Run banh login again.');
  }
  throw new Error('Auth0 login expired. Run banh login again.');
}
