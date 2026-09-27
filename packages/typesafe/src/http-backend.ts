import { BackendError } from '@banh/dsl';
import type { SystemOneQuestion } from '@banh/dsl';
import type { SystemOneBackend, SystemOneEvaluation } from '@banh/runtime';
import { normalizeTypeSafeEvaluation, toTypeSafeQuestions } from './protocol.js';

export interface TypeSafeHttpBackendOptions {
  /** Server origin or path prefix, optionally ending in /v1. */
  baseUrl: string;
  token?: string;
  /** Exact model ID sent to the server; omitted for server-default routing. */
  modelId?: string;
  /** Entire request, including response body. Defaults to 60 seconds. */
  timeoutMs?: number;
}

/** Calls an existing TypeSafe server; never loads the native SDK or weights. */
export class TypeSafeHttpBackend implements SystemOneBackend {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
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
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 2_147_483_647) {
      throw new BackendError('Inference timeout must be a positive integer at most 2147483647 ms');
    }
    this.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (options.token !== undefined) {
      if (!/^[A-Za-z0-9\-._~+/]+=*$/.test(options.token)) throw new BackendError('Invalid inference bearer token');
      this.headers.Authorization = 'Bearer ' + options.token;
    }
  }

  async evaluate(state: unknown, questions: Record<string, SystemOneQuestion>): Promise<SystemOneEvaluation> {
    if (this.closed) throw new BackendError('TypeSafe HTTP backend is closed');
    const controller = new AbortController();
    this.active.add(controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST', headers: this.headers,
        body: JSON.stringify({ state, questions: toTypeSafeQuestions(questions),
          ...(this.modelId === undefined ? {} : { model: this.modelId }) }),
        signal: controller.signal, redirect: 'manual',
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Do not echo server bodies: they can contain input or credentials.
        throw new BackendError('TypeSafe HTTP request failed (status ' + response.status + ')');
      }
      let body: unknown;
      try { body = await response.json(); }
      catch (cause) {
        if (controller.signal.aborted) throw cause;
        throw new BackendError('Invalid JSON in TypeSafe HTTP response');
      }
      return normalizeTypeSafeEvaluation(body, questions);
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new BackendError(this.closed ? 'TypeSafe HTTP backend is closed' : 'TypeSafe HTTP request timed out');
      }
      if (cause instanceof BackendError) throw cause;
      throw new BackendError('TypeSafe HTTP request failed');
    } finally {
      clearTimeout(timer);
      this.active.delete(controller);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active) controller.abort();
  }
}
