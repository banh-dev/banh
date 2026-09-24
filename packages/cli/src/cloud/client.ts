export interface Identity {
  user: { id: string; email: string };
  account: { id: string; name: string };
}
export interface Connection { apiUrl: string; token: string }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class CloudClient {
  constructor(private readonly connection: Connection, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 10_000) {}

  private async request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.connection.apiUrl}/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${this.connection.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error('Banh Cloud request timed out');
      throw new Error(`Unable to reach Banh Cloud at ${this.connection.apiUrl}. For local development, run make up in banh-cloud.`);
    }
    // Do not echo arbitrary response bodies: they may contain secrets or stack traces.
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new Error('Authentication failed. Run banh login with a valid developer token.');
      if (response.status === 403) throw new Error('Access denied. Check your developer token and account.');
      if (response.status === 429) throw new Error('Banh Cloud rate limit reached. Try again later.');
      throw new Error(`Banh Cloud request failed (HTTP ${response.status}).`);
    }
    try { return await response.json(); }
    catch { throw new Error('Banh Cloud returned an invalid JSON response'); }
  }

  async whoami(): Promise<Identity> {
    const value = await this.request('/me');
    if (!object(value) || !object(value.user) || !object(value.account) ||
      typeof value.user.id !== 'string' || typeof value.user.email !== 'string' ||
      typeof value.account.id !== 'string' || !/^acct_[a-zA-Z0-9]+$/.test(value.account.id) || typeof value.account.name !== 'string') {
      throw new Error('Banh Cloud returned an invalid identity response');
    }
    return { user: { id: value.user.id, email: value.user.email }, account: { id: value.account.id, name: value.account.name } };
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
