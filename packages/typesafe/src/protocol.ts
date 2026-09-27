import { z } from 'zod';
import { BackendError } from '@banh/dsl';
import type { SystemOneQuestion } from '@banh/dsl';
import type { DecisionResult, SystemOneEvaluation } from '@banh/runtime';

/** TypeSafe wire format belongs to the adapter, never the compiler or runtime. */
export type TypeSafeQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string }
  | { type: 'score'; instructions: string; criteria: string[] };

export function toTypeSafeQuestions(questions: Record<string, SystemOneQuestion>): Record<string, TypeSafeQuestion> {
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    const instructions = question.question;
    switch (question.type) {
      case 'one_of': return [id, { type: 'choice', instructions, criteria: { ...question.options } }];
      case 'whether': return [id, { type: 'noul', instructions }];
      case 'scale': return [id, { type: 'score', instructions, criteria: [...question.levels] }];
    }
  }));
}

const answerTypes = { one_of: 'choice', whether: 'noul', scale: 'score' } as const;

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

// Wire probabilities are commonly rounded to four decimal places.
// Allow accumulated rounding error, capped below two percentage points.
function validateDistribution(distribution: Record<string, number>, keys: string[], id: string): void {
  const tolerance = Math.min(0.02, keys.length * 0.00005 + 1e-8);
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  if (!keys.length || Object.keys(distribution).length !== keys.length ||
      keys.some(key => !Object.hasOwn(distribution, key)) || Math.abs(total - 1) > tolerance) {
    throw new BackendError(`Invalid probability distribution for "${id}"`);
  }
}

/** Convert the SDK or HTTP response at the external boundary, preserving raw answers. */
export function normalizeTypeSafeEvaluation(response: unknown, questions: Record<string, SystemOneQuestion>): SystemOneEvaluation {
  const parsed = responseSchema.safeParse(response);
  if (!parsed.success) throw new BackendError(`Invalid TypeSafe response: ${parsed.error.message}`);
  const decisions = Object.fromEntries(Object.entries(questions).map(([id, question]): [string, DecisionResult] => {
    const raw = Object.hasOwn(parsed.data.answers, id) ? parsed.data.answers[id] : undefined;
    const parsedAnswer = answerSchema.safeParse(raw);
    if (!parsedAnswer.success || parsedAnswer.data.type !== answerTypes[question.type]) {
      throw new BackendError(`Missing or invalid TypeSafe answer for "${id}" (${question.type})`);
    }
    const answer = parsedAnswer.data;
    const metadata = answer.confidence === undefined ? {} : { confidence: answer.confidence };
    if (answer.type === 'choice' && question.type === 'one_of') {
      validateDistribution(answer.probabilities, Object.keys(question.options), id);
      const selectedProbability = answer.probabilities[answer.choice];
      if (!Object.hasOwn(question.options, answer.choice) || typeof selectedProbability !== 'number' ||
          Object.keys(question.options).some(key => !Object.hasOwn(answer.probabilities, key))) {
        throw new BackendError(`Invalid choice distribution for "${id}"`);
      }
      return [id, { id, kind: 'one_of', value: answer.choice, probability: selectedProbability, probabilities: answer.probabilities, ...metadata, raw }];
    }
    if (answer.type === 'noul') {
      return [id, { id, kind: 'whether', value: answer.noul >= 0.5, probability: answer.noul, ...metadata, raw }];
    }
    if (answer.type === 'score' && question.type === 'scale') {
      validateDistribution(answer.probabilities, question.levels.map((_, index) => String(index)), id);
      if (answer.score < 0 || answer.score > question.levels.length - 1) throw new BackendError(`Out-of-range score for "${id}"`);
      return [id, { id, kind: 'scale', value: answer.score, probabilities: answer.probabilities, ...metadata, raw }];
    }
    throw new BackendError(`Unexpected TypeSafe answer for "${id}"`);
  }));
  return { decisions, usage: { inputTokens: parsed.data.usage.input_tokens } };
}

