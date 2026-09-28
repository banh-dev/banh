import { BackendError } from '@banh-dev/dsl';
import type { SystemOneQuestion } from '@banh-dev/dsl';
import { ProviderError } from '@banh-dev/runtime';
import type { ProviderErrorCode, ProviderDiagnostics, ProviderExecutionOptions, SystemOneBackend, SystemOneEvaluation } from '@banh-dev/runtime';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeTypeSafeEvaluation, toTypeSafeQuestions } from './protocol.js';

export interface TypeSafeHttpBackendOptions {
  baseUrl: string;
  token?: string;
  modelId?: string;
  /** Total deadline across attempts, backoff, and response reading. Default 60 seconds. */
  timeoutMs?: number;
  /** Default 1. Only connection failures and 502/503/504 are retried. */
  maxAttempts?: number;
  retryDelayMs?: number;
}

/** One reusable HTTP provider for TypeSafe-compatible servers. */
export class TypeSafeHttpBackend implements SystemOneBackend {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly headers: Record<string, string>;
  private readonly active = new Set<AbortController>();
  private closed = false;
  private readonly modelId: string | undefined;

  constructor(options: TypeSafeHttpBackendOptions) {
    this.modelId = options.modelId;
    if (this.modelId !== undefined && (!this.modelId.trim() || /[\x00-\x1f\x7f]/.test(this.modelId))) {
      throw new BackendError('Inference model ID must be nonblank and contain no control characters');
    }
    let url: URL;
    try { url = new URL(options.baseUrl); }
    catch { throw new BackendError('Invalid inference base URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new BackendError('Inference base URL must use HTTP(S) without credentials, query, or fragment');
    }
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = prefix.endsWith('/v1') ? prefix + '/systemone' : prefix + '/v1/systemone';
    this.endpoint = url.toString();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) {
      throw new BackendError('Inference timeout must be a positive integer at most 2147483647 ms');
    }
    if (![1, 2].includes(this.maxAttempts)) throw new BackendError('Inference maxAttempts must be 1 or 2');
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs < 0 || this.retryDelayMs > 10_000) {
      throw new BackendError('Inference retry delay must be between 0 and 10000 ms');
    }
    this.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (options.token !== undefined) {
      if (!/^[A-Za-z0-9\-._~+/]+=*$/.test(options.token)) throw new BackendError('Invalid inference bearer token');
      this.headers.Authorization = 'Bearer ' + options.token;
    }
  }

  async evaluate(state: unknown, questions: Record<string, SystemOneQuestion>, options: ProviderExecutionOptions = {}): Promise<SystemOneEvaluation> {
    if (this.closed) throw new BackendError('TypeSafe HTTP backend is closed');
    const started = performance.now();
    let attemptCount = 0;
    let responseStatus: number | undefined;
    let body: string;
    try {
      body = JSON.stringify({ state, questions: toTypeSafeQuestions(questions),
        ...(this.modelId === undefined ? {} : { model: this.modelId }) });
    } catch { throw new ProviderError('PROVIDER_BAD_REQUEST', { attemptCount: 0, latencyMs: 0, requestBytes: 0 }); }
    const requestBytes = Buffer.byteLength(body);
    const diagnostics = (): ProviderDiagnostics => ({
      attemptCount, latencyMs: performance.now() - started, requestBytes,
      ...(responseStatus === undefined ? {} : { responseStatus }),
    });
    const fail = (code: ProviderErrorCode) => new ProviderError(code, diagnostics());
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    this.active.add(controller);
    const timer = setTimeout(abort, this.timeoutMs);
    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        if (controller.signal.aborted) throw fail('PROVIDER_CANCELLED');
        attemptCount = attempt;
        responseStatus = undefined;
        options.onDiagnostics?.(diagnostics());
        let response: Response;
        try {
          response = await fetch(this.endpoint, {
            method: 'POST', headers: this.headers, body, signal: controller.signal, redirect: 'manual',
          });
        } catch {
          if (controller.signal.aborted) throw fail('PROVIDER_CANCELLED');
          if (attempt === this.maxAttempts) throw fail('PROVIDER_UNAVAILABLE');
          await delay(this.retryDelayMs * 2 ** (attempt - 1), undefined, { signal: controller.signal });
          continue;
        }
        responseStatus = response.status;
        options.onDiagnostics?.(diagnostics());
        if (!response.ok) {
          await response.body?.cancel();
          if ([502, 503, 504].includes(response.status) && attempt < this.maxAttempts) {
            await delay(this.retryDelayMs * 2 ** (attempt - 1), undefined, { signal: controller.signal });
            continue;
          }
          throw fail(response.status === 401 || response.status === 403 ? 'PROVIDER_UNAUTHORIZED'
            : response.status === 429 || [502, 503, 504].includes(response.status) ? 'PROVIDER_UNAVAILABLE'
            : response.status >= 400 && response.status < 500 ? 'PROVIDER_BAD_REQUEST' : 'PROVIDER_INTERNAL_ERROR');
        }
        let value: unknown;
        try { value = await response.json(); }
        catch { throw fail('PROVIDER_RESPONSE_INVALID'); }
        let result: SystemOneEvaluation;
        try { result = normalizeTypeSafeEvaluation(value, questions); }
        catch { throw fail('PROVIDER_RESPONSE_INVALID'); }
        const model = typeof value === 'object' && value !== null && 'model' in value ? value.model : undefined;
        const details = diagnostics();
        // Only an identifier, never arbitrary upstream diagnostic text.
        if (typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._/@-]{0,127}$/.test(model)) details.upstreamModel = model;
        options.onDiagnostics?.(details);
        return { ...result, diagnostics: details };
      }
      throw fail('PROVIDER_INTERNAL_ERROR');
    } catch (cause) {
      if (controller.signal.aborted) {
        throw fail(this.closed || options.signal?.aborted ? 'PROVIDER_CANCELLED' : 'PROVIDER_TIMEOUT');
      }
      if (cause instanceof ProviderError) throw cause;
      throw fail('PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      this.active.delete(controller);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active) controller.abort();
  }
}
