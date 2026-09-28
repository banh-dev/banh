import { normalizeLayaEvaluation, toLayaQuestions } from './protocol.js';
import type { Laya } from '@receptron/laya';
import type { SystemOneQuestion } from '@banh-dev/dsl';
import { BackendError } from '@banh-dev/dsl';
import type { SystemOneBackend, SystemOneEvaluation } from '@banh-dev/runtime';

/** Local model configuration; absent modelDir downloads and caches the bundle. */
export interface LayaBackendOptions {
  modelDir?: string;
  cacheDir?: string;
  revision?: string;
  executionProviders?: string[];
}

/** Loads one Laya instance and reuses it for whole-process inference batches. */
export class LayaBackend implements SystemOneBackend {
  private closed = false;
  private constructor(private readonly laya: Laya) {}

  static async create(options: LayaBackendOptions = {}): Promise<LayaBackend> {
    try {
      const { Laya } = await import('@receptron/laya');
      return new LayaBackend(await Laya.load(options));
    } catch (cause) {
      throw new BackendError(`Unable to load Laya: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }

  async evaluate(state: unknown, questions: Record<string, SystemOneQuestion>): Promise<SystemOneEvaluation> {
    if (this.closed) throw new BackendError('Laya backend is closed');
    try {
      return normalizeLayaEvaluation(await this.laya.systemOne(state, toLayaQuestions(questions)), questions);
    } catch (cause) {
      if (cause instanceof BackendError) throw cause;
      throw new BackendError(`Laya inference failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { await this.laya.close(); }
    catch (cause) { throw new BackendError(`Unable to close Laya: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }); }
  }
}
