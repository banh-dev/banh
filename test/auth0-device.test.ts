import { expect, it, vi } from 'vitest';
import { deviceLogin, discoverAuth0, parseAuth0Settings } from '../packages/cli/src/cloud/auth0.js';
import { resolveConnection } from '../packages/cli/src/cloud/config.js';

const config = { issuer: 'https://tenant.example/', clientId: 'native-client', audience: 'https://banh.test' };
const device = { device_code: 'SECRET_DEVICE', user_code: 'ABCD-EFGH', verification_uri: 'https://tenant.example/activate', verification_uri_complete: 'https://tenant.example/activate?user_code=ABCD-EFGH', expires_in: 60, interval: 2 };
const grant = { access_token: 'SECRET_ACCESS', token_type: 'Bearer', expires_in: 3600 };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture() {
  let clock = 0;
  return {
    fetch: vi.fn<typeof fetch>(), stdout: vi.fn(), openBrowser: vi.fn(async () => {}),
    now: () => clock, sleep: vi.fn(async (milliseconds: number) => { clock += milliseconds; }),
  };
}
it('discovers settings without credentials', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(config));
  expect(await discoverAuth0('http://localhost:3000', fetcher)).toEqual(config);
  expect(fetcher.mock.calls[0]![0]).toBe('http://localhost:3000/v1/auth/config');
  expect(fetcher.mock.calls[0]![1]?.headers).toBeUndefined();
});
it('polls at the required interval, slows down, and returns only the access token', async () => {
  const deps = fixture();
  deps.fetch.mockResolvedValueOnce(reply(device))
    .mockResolvedValueOnce(reply({ error: 'authorization_pending' }, 400))
    .mockResolvedValueOnce(reply({ error: 'slow_down' }, 400))
    .mockResolvedValueOnce(reply({ ...grant, id_token: 'IGNORE_ID', refresh_token: 'IGNORE_REFRESH' }));
  expect(await deviceLogin(config, deps)).toEqual({ token: 'SECRET_ACCESS', expiresAt: 3_611_000 });
  expect(deps.sleep.mock.calls.map(call => call[0])).toEqual([2000, 2000, 7000]);
  expect(deps.openBrowser).toHaveBeenCalledWith(device.verification_uri_complete);
  const request = new URLSearchParams(String(deps.fetch.mock.calls[0]![1]?.body));
  expect(request.get('scope')).toBe('openid profile email');
  expect(request.has('client_secret')).toBe(false);
  expect(request.get('audience')).toBe(config.audience);
  const poll = new URLSearchParams(String(deps.fetch.mock.calls[1]![1]?.body));
  expect(poll.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
  expect(poll.get('device_code')).toBe(device.device_code);
  const output = deps.stdout.mock.calls.flat().join(' ');
  expect(output).toContain(device.user_code);
  expect(output).not.toContain('SECRET');
});
it.each(['access_denied', 'expired_token', 'invalid_grant'])('handles %s without exposing provider diagnostics', async error => {
  const deps = fixture(); deps.fetch.mockResolvedValueOnce(reply(device)).mockResolvedValueOnce(reply({ error, error_description: 'SECRET' }, 400));
  await expect(deviceLogin(config, deps)).rejects.toThrow(/denied|expired|failed/);
  expect(deps.stdout.mock.calls.flat().join(' ')).not.toContain('SECRET');
});
it('expires a pending login without polling after its deadline', async () => {
  const deps = fixture(); deps.fetch.mockResolvedValueOnce(reply({ ...device, expires_in: 3 })).mockResolvedValue(reply({ error: 'authorization_pending' }, 400));
  await expect(deviceLogin(config, deps)).rejects.toThrow('expired');
  expect(deps.fetch).toHaveBeenCalledTimes(2);
});
it('supports no-browser and browser launch failure', async () => {
  for (const noBrowser of [true, false]) {
    const deps = fixture(); deps.openBrowser.mockRejectedValue(new Error('unavailable'));
    deps.fetch.mockResolvedValueOnce(reply(device)).mockResolvedValueOnce(reply(grant));
    expect((await deviceLogin(config, { ...deps, noBrowser })).token).toBe(grant.access_token);
    expect(deps.openBrowser).toHaveBeenCalledTimes(noBrowser ? 0 : 1);
  }
});
it('cancels polling', async () => {
  const deps = fixture(); const controller = new AbortController();
  deps.fetch.mockResolvedValueOnce(reply(device));
  deps.sleep.mockImplementation(async () => { controller.abort(); });
  await expect(deviceLogin(config, { ...deps, signal: controller.signal })).rejects.toThrow('cancelled');
  expect(deps.fetch).toHaveBeenCalledOnce();
});
it('rejects non-HTTPS issuers and foreign verification URLs', async () => {
  expect(() => parseAuth0Settings({ ...config, issuer: 'http://tenant.example/' })).toThrow();
  const deps = fixture(); deps.fetch.mockResolvedValue(reply({ ...device, verification_uri_complete: 'https://attacker.example/' }));
  await expect(deviceLogin(config, deps)).rejects.toThrow('does not match');
  expect(deps.openBrowser).not.toHaveBeenCalled();
});
it('rejects malformed token responses and unavailable tenant configuration', async () => {
  const deps = fixture(); deps.fetch.mockResolvedValueOnce(reply(device)).mockResolvedValueOnce(reply({ id_token: 'not an access token' }));
  await expect(deviceLogin(config, deps)).rejects.toThrow('Invalid Auth0 token');
  await expect(discoverAuth0('http://localhost:3000', vi.fn<typeof fetch>().mockResolvedValue(reply({}, 503)))).rejects.toThrow('Configure Auth0');
});
it('requires reauthentication for expired saved access tokens, but allows an environment override', () => {
  const saved = { apiUrl: 'http://localhost:3000', token: 'expired', accountId: 'acct_test', expiresAt: 1 };
  expect(() => resolveConnection({}, saved)).toThrow('expired');
  expect(resolveConnection({ BANH_API_TOKEN: 'fresh' }, saved).token).toBe('fresh');
});
