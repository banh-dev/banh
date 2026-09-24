import type { SystemOneBackend, SystemOneEvaluation } from '@banh/runtime';
import type { SystemOneQuestion } from '@banh/dsl';

export class FakeSystemOneBackend implements SystemOneBackend {
  calls: { state: unknown; questions: Record<string, SystemOneQuestion> }[] = [];
  closed = false;
  constructor(public evaluation: SystemOneEvaluation) {}
  async evaluate(state: unknown, questions: Record<string, SystemOneQuestion>) {
    this.calls.push({ state, questions });
    return structuredClone(this.evaluation);
  }
  async close() { this.closed = true; }
}

export function fakeBackend() {
  return new FakeSystemOneBackend({
    decisions: {
      department: { id: 'department', kind: 'one_of', value: 'billing', probability: 0.9, confidence: 0.8, raw: {} },
      urgent: { id: 'urgent', kind: 'whether', value: false, probability: 0.1, raw: {} },
      severity: { id: 'severity', kind: 'scale', value: 1.4, raw: {} },
    },
    usage: { inputTokens: 42 },
  });
}
