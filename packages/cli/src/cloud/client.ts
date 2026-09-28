export interface Identity {
  user: { id: string; email: string | null };
  account: { id: string; name: string };
}
export interface CloudRun {
  id: string; workflow: string; version: number; status: 'completed' | 'failed';
  output: unknown; decisions: unknown; trace: unknown;
  error?: { code: string };
}
export interface RunRecord extends Omit<CloudRun, 'status' | 'error'> {
  status: 'running' | 'completed' | 'failed';
  createdAt: string; completedAt: string | null; durationMs: number | null;
  error?: { code: string; message: string };
}
export interface InspectedRun extends RunRecord { input: unknown }
export interface BillingStatus {
  mode?: 'test' | 'live';
  status: string; plan: string | null; periodStart: string | null; periodEnd: string | null;
  limit: number; used: number; reserved: number; remaining: number;
  retentionDays: number | null; cancelAtPeriodEnd: boolean;
}
export interface Connection { apiUrl: string; token: string }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isRunRecord(value: unknown): value is RunRecord {
  return object(value) && typeof value.id === 'string' && /^run_[a-zA-Z0-9]+$/.test(value.id) &&
    typeof value.workflow === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(value.workflow) &&
    typeof value.version === 'number' && Number.isInteger(value.version) && value.version > 0 &&
    ['running', 'completed', 'failed'].includes(String(value.status)) &&
    typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)) &&
    (value.completedAt === null || (typeof value.completedAt === 'string' && Number.isFinite(Date.parse(value.completedAt)))) &&
    (value.durationMs === null || (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0)) &&
    Object.hasOwn(value, 'output') && object(value.decisions) && (value.trace === null || object(value.trace)) &&
    (value.error === undefined || (object(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'));
}

export class CloudClient {
  constructor(private readonly connection: Connection, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 10_000) {}

  private async request(path: string, body?: unknown, runRequest = false): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.connection.apiUrl}/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${this.connection.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(runRequest ? 300_000 : this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error('Banh Cloud request timed out');
      throw new Error(`Unable to reach Banh Cloud at ${this.connection.apiUrl}. For local development, run make up in banh-cloud.`);
    }
    const retryAfter = response.headers.get('retry-after');
    if ([429, 503].includes(response.status) && retryAfter && /^\d+$/.test(retryAfter) && Number(retryAfter) <= 86400) {
      await response.body?.cancel();
      throw new Error(`Hosted inference is temporarily limited. Retry in ${retryAfter} seconds. No run allowance was used.`);
    }
    // Do not echo arbitrary response bodies: they may contain secrets or stack traces.
    if (!response.ok && !(runRequest && [500, 502, 503, 504].includes(response.status))) {
      await response.body?.cancel();
      if (response.status === 401) throw new Error('Authentication failed. Run banh login to obtain a valid Auth0 access token.');
      if (response.status === 403) throw new Error('Access denied. Check that your Auth0 identity is linked to the selected Banh account.');
      if (response.status === 404) throw new Error('Workflow or run not found in the selected account.');
      if (response.status === 402) throw new Error('A paid subscription is required. Run banh billing checkout starter or banh billing checkout pro.');
      if (response.status === 409) throw new Error('Requested change is unavailable. Check your current subscription or active invocation keys.');
      if (response.status === 413) throw new Error('Cloud request is too large. Shorten the input, decision questions, or answer options. Hosted runs have an approximate 8,000-token input limit; rejected requests use no run allowance.');
      if (response.status === 429) throw new Error('Request or run allowance limit reached. Check banh billing status before retrying.');
      throw new Error(`Banh Cloud request failed (HTTP ${response.status}).`);
    }
    try { return await response.json(); }
    catch { throw new Error('Banh Cloud returned an invalid JSON response'); }
  }

  async whoami(accountId?: string): Promise<Identity> {
    const value = await this.request(`/me${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`);
    if (!object(value) || !object(value.user) || !object(value.account) ||
      typeof value.user.id !== 'string' || (value.user.email !== null && typeof value.user.email !== 'string') ||
      typeof value.account.id !== 'string' || !/^acct_[a-zA-Z0-9]+$/.test(value.account.id) || typeof value.account.name !== 'string') {
      throw new Error('Banh Cloud returned an invalid identity response');
    }
    return { user: { id: value.user.id, email: value.user.email }, account: { id: value.account.id, name: value.account.name } };
  }

  async invoke(accountId: string, workflow: string, input: unknown): Promise<CloudRun> {
    const value = await this.request(`/accounts/${encodeURIComponent(accountId)}/workflows/${encodeURIComponent(workflow)}/runs`, { input }, true);
    if (!object(value) || typeof value.id !== 'string' || !/^run_[a-zA-Z0-9]+$/.test(value.id) ||
        value.workflow !== workflow || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1 ||
        !['completed', 'failed'].includes(String(value.status)) ||
        !Object.hasOwn(value, 'output') || !object(value.decisions) ||
        (value.status === 'completed' ? !object(value.trace) || value.error !== undefined :
          value.trace !== null && !object(value.trace)) ||
        (value.status === 'failed' && (!object(value.error) || typeof value.error.code !== 'string')) ||
        (value.error !== undefined && (!object(value.error) || typeof value.error.code !== 'string'))) {
      throw new Error('Banh Cloud returned an invalid run response');
    }
    return value as unknown as CloudRun;
  }

  async runs(accountId: string, workflow: string, limit = 50, offset = 0) {
    const value = await this.request(`/accounts/${encodeURIComponent(accountId)}/workflows/${encodeURIComponent(workflow)}/runs?limit=${limit}&offset=${offset}`);
    if (!object(value) || !Array.isArray(value.runs) || value.runs.length > limit ||
        !value.runs.every(run => isRunRecord(run) && run.workflow === workflow) || value.limit !== limit || value.offset !== offset) {
      throw new Error('Banh Cloud returned an invalid run list');
    }
    return { runs: value.runs as RunRecord[], limit, offset };
  }

  async inspect(accountId: string, runId: string): Promise<InspectedRun> {
    const value = await this.request(`/accounts/${encodeURIComponent(accountId)}/runs/${encodeURIComponent(runId)}`);
    if (!isRunRecord(value) || value.id !== runId || !Object.hasOwn(value, 'input')) {
      throw new Error('Banh Cloud returned an invalid run record');
    }
    return value as InspectedRun;
  }

  async keys(accountId: string, action: 'list' | 'create' | 'revoke', keyId?: string) {
    const value = await this.request(`/accounts/${encodeURIComponent(accountId)}/keys${action === 'revoke' ? `/${encodeURIComponent(keyId!)}/revoke` : ''}`,
      action === 'list' ? undefined : {});
    const validId = (id: unknown) => typeof id === 'string' && /^key_[a-zA-Z0-9]+$/.test(id);
    if (!object(value)) throw new Error('Invalid invocation key response');
    if (action === 'create' && validId(value.id) && typeof value.apiKey === 'string' && /^banh_sk_[a-f0-9]{64}$/.test(value.apiKey)) {
      return { id: value.id as string, apiKey: value.apiKey };
    }
    if (action === 'revoke' && value.id === keyId && value.revoked === true) return { id: keyId!, revoked: true };
    if (action === 'list' && Array.isArray(value.keys) && value.keys.length <= 100 && value.keys.every(key =>
      object(key) && validId(key.id) && typeof key.prefix === 'string' && /^banh_sk_[a-f0-9]{10}$/.test(key.prefix) &&
      typeof key.createdAt === 'string' && Number.isFinite(Date.parse(key.createdAt)) &&
      (key.revokedAt === null || (typeof key.revokedAt === 'string' && Number.isFinite(Date.parse(key.revokedAt)))))) {
      return { keys: value.keys.map(key => ({ id: key.id as string, prefix: key.prefix as string, createdAt: key.createdAt as string, revokedAt: key.revokedAt as string | null })) };
    }
    throw new Error('Invalid invocation key response');
  }

  async billing(accountId: string, action: 'status' | 'checkout' | 'portal' | 'plan', plan?: string): Promise<BillingStatus | { url: string }> {
    const value = await this.request(`/accounts/${encodeURIComponent(accountId)}/billing${action === 'status' ? '' : `/${action}`}`,
      action === 'status' ? undefined : action === 'portal' ? {} : { plan });
    if (action === 'portal' || action === 'checkout') {
      if (!object(value) || typeof value.url !== 'string') throw new Error('Invalid billing URL');
      const url = new URL(value.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.stripe.com') || url.username || url.password) throw new Error('Invalid billing URL');
      return { url: value.url };
    }
    if (!object(value) || (value.mode !== undefined && value.mode !== 'test' && value.mode !== 'live') || typeof value.status !== 'string' || ![null,'starter','pro'].includes(value.plan as string | null) ||
        typeof value.cancelAtPeriodEnd !== 'boolean' ||
        !['limit','used','reserved','remaining'].every(key => typeof value[key] === 'number' && Number.isInteger(value[key]) && (value[key] as number) >= 0) ||
        !['periodStart','periodEnd'].every(key => value[key] === null || (typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key])))) ||
        !(value.retentionDays === null || (typeof value.retentionDays === 'number' && Number.isInteger(value.retentionDays) && value.retentionDays > 0))) throw new Error('Invalid billing response');
    return value as unknown as BillingStatus;
  }

  async deploy(accountId: string, workflow: string, sourceYaml: string, compiled: unknown) {
    const value = await this.request(`/accounts/${encodeURIComponent(accountId)}/workflows/${encodeURIComponent(workflow)}/versions`, { sourceYaml, compiled });
    if (!object(value) || value.workflow !== workflow || typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
      throw new Error('Banh Cloud returned an invalid deployment response');
    }
    return { workflow, version: value.version,
      invokeUrl: `${this.connection.apiUrl}/v1/accounts/${encodeURIComponent(accountId)}/workflows/${encodeURIComponent(workflow)}/runs` };
  }
}
