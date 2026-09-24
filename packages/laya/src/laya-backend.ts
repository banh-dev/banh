import { z } from 'zod';
import type { Laya } from '@receptron/laya';
import type { SystemOneQuestion } from '@banh/dsl';
import type { DecisionResult } from '@banh/runtime';
import { BackendError } from '@banh/dsl';
import type { SystemOneBackend, SystemOneEvaluation } from '@banh/runtime';

/** Local model configuration; absent modelDir downloads and caches the bundle. */
export interface LayaBackendOptions {
  modelDir?: string;
  cacheDir?: string;
  revision?: string;
  executionProviders?: string[];
}

const probability = z.number().min(0).max(1);
const probabilities = z.record(z.string(), probability);
const answerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities, confidence: probability.optional() }),
  z.object({ type: z.literal('noul'), noul: probability, confidence: probability.optional() }),
  z.object({ type: z.literal('score'), score: z.number(), probabilities, confidence: probability.optional() }),
]);
const responseSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }),
});

/** Convert the SDK response at the external boundary, preserving raw answers. */
export function normalizeLayaEvaluation(response: unknown, questions: Record<string, SystemOneQuestion>): SystemOneEvaluation {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new BackendError(`Invalid Laya response: ${parsed.error.message}`);
  const decisions = Object.fromEntries(Object.entries(questions).map(([id, question]): [string, DecisionResult] => {
    const raw = Object.hasOwn(parsed.data.answers, id) ? parsed.data.answers[id] : undefined;
    const parsedAnswer = answerSchema.safeParse(raw);
    if (!parsedAnswer.success || parsedAnswer.data.type !== question.type) {
      throw new BackendError(`Missing or invalid Laya answer for "${id}" (${question.type})`);
    }
    const answer = parsedAnswer.data;
    const metadata = answer.confidence === undefined ? {} : { confidence: answer.confidence };
    if (answer.type === 'choice' && question.type === 'choice') {
      const selectedProbability = answer.probabilities[answer.choice];
      if (!Object.hasOwn(question.criteria, answer.choice) || typeof selectedProbability !== 'number' ||
          Object.keys(question.criteria).some(key => !Object.hasOwn(answer.probabilities, key))) {
        throw new BackendError(`Invalid choice distribution for "${id}"`);
      }
      return [id, { id, kind: 'one_of', value: answer.choice, probability: selectedProbability, probabilities: answer.probabilities, ...metadata, raw }];
    }
    if (answer.type === 'noul') {
      return [id, { id, kind: 'whether', value: answer.noul >= 0.5, probability: answer.noul, ...metadata, raw }];
    }
    if (answer.type === 'score' && question.type === 'score') {
      if (answer.score < 0 || answer.score > question.criteria.length - 1) throw new BackendError(`Out-of-range score for "${id}"`);
      return [id, { id, kind: 'scale', value: answer.score, probabilities: answer.probabilities, ...metadata, raw }];
    }
    throw new BackendError(`Unexpected Laya answer for "${id}"`);
  }));
  return { decisions, usage: { inputTokens: parsed.data.usage.input_tokens } };
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
      return normalizeLayaEvaluation(await this.laya.systemOne(state, questions), questions);
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
