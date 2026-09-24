# PLAN.md — Banh (working name)

## Goal

Build a small TypeScript runtime and YAML DSL for declarative System 1 programs.

Version 0 targets **Laya only** via `@receptron/laya`.

The system should let a developer write a YAML file that:

1. Defines an input state.
2. Defines one or more bounded decisions.
3. Compiles those decisions into Laya `systemOne(...)` questions.
4. Executes all compatible decisions in one Laya forward pass where possible.
5. Exposes typed results to deterministic control-flow rules.
6. Produces a final action/result.
7. Can be executed and validated from a CLI.

This is **not** an agent framework.

There must be no open-ended tool loop, autonomous planning loop, prompt chaining abstraction, or free-form “decide what to do next” behavior in v0.

The core concept is:

```text
YAML
  ↓
Parser
  ↓
Validated AST
  ↓
Execution Plan
  ↓
Laya System One inference
  ↓
Typed decision results
  ↓
Deterministic rules
  ↓
Final result/action
```

---

# Product Principle

The language should treat **probabilistic decisions as first-class programming primitives**.

The user should describe semantic decisions such as:

```yaml
decisions:
  department:
    decide: one_of
    question: Which team should handle this ticket?
    options:
      billing: Payments, refunds, invoices
      support: Product problems and bugs
      sales: New purchases

  urgent:
    decide: whether
    question: Does this require urgent attention?

  severity:
    decide: scale
    question: How severe is this issue?
    levels:
      - low
      - medium
      - high
      - critical
```

The compiler maps these concepts to Laya:

```text
one_of  → choice
whether → noul
scale   → score
```

Do not leak Laya-specific terminology into the public DSL unless absolutely necessary.

---

# Laya Integration Facts

Use the official Node package:

```bash
npm install @receptron/laya
```

Minimum Node version:

```text
Node.js >= 20
```

Basic API:

```ts
import { Laya } from "@receptron/laya";

const laya = await Laya.load();

const result = await laya.systemOne(
  state,
  questions
);

await laya.close();
```

Laya accepts a state that is a string, JSON object, or array.

Supported question types:

```ts
choice
score
noul
```

Example Laya question payload:

```ts
const questions = {
  department: {
    type: "choice",
    instructions: "Which team should handle this ticket?",
    criteria: {
      billing: "payments, refunds, invoices",
      support: "product help and bugs",
      sales: "new purchases"
    }
  },

  urgency: {
    type: "score",
    instructions: "How urgent is this ticket?",
    criteria: [
      "not urgent",
      "somewhat urgent",
      "urgent",
      "critical"
    ]
  },

  churnRisk: {
    type: "noul",
    instructions: "Is the customer likely to cancel or dispute?"
  }
};
```

Important runtime behavior:

- All questions sent in one `systemOne` call are batched into a single model run.
- Prefer one inference call per state whenever possible.
- The model weights are downloaded on first load unless a local model directory is configured.
- The model should be loaded once per process and reused.
- Laya's English checkpoint has limited context; do not assume arbitrarily large state.
- Choice questions should stay relatively small. Avoid designing the DSL around hundreds of options.
- `score` results are expected numeric rubric positions.
- `noul` returns a probability representing P(true).
- `choice` returns the winning option and probabilities by option.

Do not add additional model providers yet.

---

# Tech Stack

Use:

```text
TypeScript
Node.js >= 20
ESM
yaml
zod
tsx
vitest
```

Use `@receptron/laya` for inference.

Suggested packages:

```bash
npm install yaml zod @receptron/laya
npm install -D typescript tsx vitest @types/node
```

Do not add a web framework, database, queue, Temporal, Docker, or frontend in v0.

---

# Repository Structure

Create a simple package first.

```text
/
├── package.json
├── tsconfig.json
├── README.md
├── PLAN.md
├── examples/
│   ├── support-triage.yaml
│   ├── warranty-claim.yaml
│   └── inputs/
│       ├── support-ticket.json
│       └── warranty-claim.json
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   ├── run.ts
│   │   └── validate.ts
│   ├── dsl/
│   │   ├── schema.ts
│   │   ├── parser.ts
│   │   ├── types.ts
│   │   └── errors.ts
│   ├── compiler/
│   │   ├── compiler.ts
│   │   ├── decisions.ts
│   │   └── expressions.ts
│   ├── runtime/
│   │   ├── runtime.ts
│   │   ├── execution-context.ts
│   │   ├── evaluator.ts
│   │   └── result.ts
│   ├── backends/
│   │   ├── system-one-backend.ts
│   │   └── laya-backend.ts
│   ├── actions/
│   │   ├── action.ts
│   │   └── builtins.ts
│   └── index.ts
└── test/
    ├── parser.test.ts
    ├── compiler.test.ts
    ├── evaluator.test.ts
    ├── runtime.test.ts
    └── fixtures/
```

Keep modules small.

---

# Phase 1 — Define the DSL

Implement this minimal YAML shape first:

```yaml
version: 1

process: support_triage

input:
  type: json

decisions:
  department:
    decide: one_of
    question: Which team should handle this ticket?
    options:
      billing: Payments, refunds, invoices
      support: Product problems and bugs
      sales: New purchases

  urgent:
    decide: whether
    question: Does this require urgent attention?

  severity:
    decide: scale
    question: How severe is this issue?
    levels:
      - low
      - medium
      - high
      - critical

flow:
  - when: urgent.probability >= 0.85
    do: return
    value:
      route: escalation

  - when: department.value == "billing"
    do: return
    value:
      route: billing

  - else:
      do: return
      value:
        route: support
```

## DSL v0 schema

Top-level fields:

```ts
interface ProcessFile {
  version: 1;
  process: string;
  input?: InputDefinition;
  decisions: Record<string, DecisionDefinition>;
  flow: FlowStep[];
}
```

Input:

```ts
interface InputDefinition {
  type: "json" | "text";
}
```

Decision definitions:

```ts
type DecisionDefinition =
  | OneOfDecision
  | WhetherDecision
  | ScaleDecision;
```

One-of:

```ts
interface OneOfDecision {
  decide: "one_of";
  question: string;
  options: Record<string, string>;
}
```

Whether:

```ts
interface WhetherDecision {
  decide: "whether";
  question: string;
}
```

Scale:

```ts
interface ScaleDecision {
  decide: "scale";
  question: string;
  levels: string[];
}
```

Flow:

```ts
type FlowStep =
  | ConditionalFlowStep
  | ElseFlowStep;
```

For v0, support only:

```yaml
do: return
```

Do not implement HTTP, email, queues, shell execution, arbitrary JavaScript, or plugins yet.

---

# Phase 2 — Parse and Validate YAML

Implement:

```ts
parseProcess(source: string): ProcessFile
```

Responsibilities:

1. Parse YAML using `yaml`.
2. Validate the result with Zod.
3. Reject malformed process definitions.
4. Return a strongly typed internal representation.
5. Produce useful errors with YAML path information where practical.

Validation rules:

- `version` must equal `1`.
- `process` must be non-empty.
- `decisions` must contain at least one item.
- Decision IDs must be unique by object key.
- `one_of` must contain at least 2 options.
- `one_of` option keys must be unique.
- `scale` must contain at least 2 levels.
- `question` must be non-empty.
- `flow` must contain at least one step.
- `else` may only appear once.
- `else` must be the last flow entry.
- Expressions may only reference existing decisions and supported result properties.

Add tests for each validation rule.

---

# Phase 3 — Create a Provider-Neutral Backend Interface

Even though only Laya is implemented, do not directly couple runtime code to the `Laya` class.

Create:

```ts
export interface SystemOneBackend {
  evaluate(
    state: unknown,
    questions: Record<string, SystemOneQuestion>
  ): Promise<SystemOneEvaluation>;

  close(): Promise<void>;
}
```

Internal question types:

```ts
export type SystemOneQuestion =
  | ChoiceQuestion
  | ScoreQuestion
  | BooleanQuestion;
```

Example:

```ts
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export interface BooleanQuestion {
  type: "noul";
  instructions: string;
}
```

Internal normalized answer:

```ts
export interface DecisionResult {
  id: string;
  kind: "one_of" | "whether" | "scale";

  value: string | boolean | number;

  probability?: number;

  confidence?: number;

  probabilities?: Record<string, number>;

  raw: unknown;
}
```

This interface is the future seam for Jev or another System One model.

Do not implement those providers now.

---

# Phase 4 — Compile DSL Decisions Into Laya Questions

Create:

```ts
compileDecisions(
  decisions: Record<string, DecisionDefinition>
): Record<string, SystemOneQuestion>
```

Mappings:

## `one_of`

Input:

```yaml
department:
  decide: one_of
  question: Which team should handle this?
  options:
    billing: Payments and refunds
    support: Product issues
```

Output:

```ts
{
  department: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: {
      billing: "Payments and refunds",
      support: "Product issues"
    }
  }
}
```

## `whether`

Input:

```yaml
urgent:
  decide: whether
  question: Is this urgent?
```

Output:

```ts
{
  urgent: {
    type: "noul",
    instructions: "Is this urgent?"
  }
}
```

## `scale`

Input:

```yaml
severity:
  decide: scale
  question: How severe is the issue?
  levels:
    - low
    - medium
    - high
```

Output:

```ts
{
  severity: {
    type: "score",
    instructions: "How severe is the issue?",
    criteria: [
      "low",
      "medium",
      "high"
    ]
  }
}
```

The compiler must have no dependency on `@receptron/laya`.

---

# Phase 5 — Implement `LayaBackend`

Create:

```ts
export class LayaBackend implements SystemOneBackend
```

Use:

```ts
import { Laya } from "@receptron/laya";
```

Construction should be asynchronous:

```ts
const backend = await LayaBackend.create();
```

Suggested API:

```ts
export interface LayaBackendOptions {
  modelDir?: string;
  cacheDir?: string;
  revision?: string;
  executionProviders?: string[];
}
```

Implementation principles:

- Call `Laya.load(...)` once.
- Reuse the loaded instance.
- Call `systemOne(state, questions)` once per execution.
- Do not loop over questions.
- Normalize Laya answers into `DecisionResult`.
- Preserve the original answer under `raw`.
- Expose Laya token usage in the execution metadata.
- Ensure `close()` calls `laya.close()`.

Expected normalization:

## choice

Laya:

```ts
{
  choice: "billing",
  probabilities: {
    billing: 0.94,
    support: 0.06
  },
  confidence: 0.8
}
```

Normalized:

```ts
{
  id: "department",
  kind: "one_of",
  value: "billing",
  probability: 0.94,
  confidence: 0.8,
  probabilities: {
    billing: 0.94,
    support: 0.06
  },
  raw: ...
}
```

## noul

Laya:

```ts
{
  noul: 0.91,
  confidence: ...
}
```

Normalized:

```ts
{
  id: "urgent",
  kind: "whether",
  value: true,
  probability: 0.91,
  confidence: ...,
  raw: ...
}
```

For v0:

```text
whether.value = noul >= 0.5
whether.probability = noul
```

Keep the raw probability available so flow logic can use:

```text
urgent.probability >= 0.85
```

## score

Laya:

```ts
{
  score: 2.6,
  probabilities: ...
}
```

Normalized:

```ts
{
  id: "severity",
  kind: "scale",
  value: 2.6,
  probabilities: ...,
  raw: ...
}
```

Do not round the score unless Laya already has.

---

# Phase 6 — Expression Evaluator

Do not use `eval`, `Function`, JavaScript parsing, or execute user-provided code.

Implement a deliberately tiny expression grammar.

Support:

```text
department.value == "billing"
department.value != "billing"

urgent.value == true
urgent.value == false

urgent.probability >= 0.85
urgent.probability > 0.85
urgent.probability <= 0.85
urgent.probability < 0.85

severity.value >= 2
```

Supported operators:

```text
==
!=
>
>=
<
<=
```

Supported left operands:

```text
<decision>.value
<decision>.probability
<decision>.confidence
```

Supported literal types:

```text
string
number
boolean
```

Create:

```ts
parseExpression(source: string): ExpressionAst
evaluateExpression(
  expression: ExpressionAst,
  context: ExecutionContext
): boolean
```

A simple tokenizer/parser is enough.

Do not support:

```text
&&
||
!
()
arithmetic
function calls
property traversal beyond approved decision fields
```

Those can come later.

---

# Phase 7 — Runtime

Create:

```ts
export class ProcessRuntime
```

Suggested API:

```ts
const runtime = new ProcessRuntime(backend);

const result = await runtime.execute(
  processDefinition,
  input
);
```

Execution order:

```text
1. Validate process definition
2. Compile all decisions
3. Send the input state + all questions to Laya
4. Normalize decision results
5. Build ExecutionContext
6. Evaluate flow from top to bottom
7. Execute first matching return
8. Return execution result
```

Execution context:

```ts
interface ExecutionContext {
  input: unknown;
  decisions: Record<string, DecisionResult>;
}
```

Execution result:

```ts
interface ProcessExecutionResult {
  process: string;
  output: unknown;

  decisions: Record<string, DecisionResult>;

  usage?: {
    inputTokens?: number;
  };

  timing: {
    totalMs: number;
    inferenceMs?: number;
  };
}
```

Flow evaluation is deterministic.

Example:

```yaml
flow:
  - when: urgent.probability >= 0.85
    do: return
    value:
      route: escalation

  - when: department.value == "billing"
    do: return
    value:
      route: billing

  - else:
      do: return
      value:
        route: support
```

Evaluate in order.

First match wins.

---

# Phase 8 — Template Interpolation

After the runtime works, add minimal value interpolation to returned objects.

Example:

```yaml
flow:
  - when: urgent.probability >= 0.85
    do: return
    value:
      route: escalation
      department: "{{ department.value }}"
      confidence: "{{ department.confidence }}"
```

Only support entire-string interpolation initially.

Supported:

```yaml
value: "{{ department.value }}"
```

Do not support:

```yaml
value: "Route to {{ department.value }} please"
```

unless easy to add safely.

Do not use arbitrary JS evaluation.

---

# Phase 9 — CLI

Provide the executable:

```bash
banh
```

Working name can be changed later.

Commands:

```bash
banh validate workflow.yaml
banh run workflow.yaml --input input.json
```

Optional:

```bash
banh run workflow.yaml --text "my input text"
```

## `validate`

Example:

```text
$ banh validate examples/support-triage.yaml

✓ YAML parsed
✓ schema valid
✓ 3 decisions
✓ 3 flow rules
✓ all expression references valid

Process is valid.
```

Validation must not load Laya.

## `run`

Example:

```text
$ banh run examples/support-triage.yaml \
    --input examples/inputs/support-ticket.json
```

Output:

```text
Process: support_triage

Decisions

department
  value        billing
  probability  0.9415
  confidence   0.8120

urgent
  value        false
  probability  0.0988

severity
  value        1.3886

Result

{
  "route": "billing"
}

Inference: 143 ms
Total:     151 ms
Tokens:    267
```

Add:

```bash
--json
```

which emits machine-readable JSON only.

---

# Phase 10 — Example Workflows

Create at least two polished examples.

## Example 1 — Support routing

```yaml
version: 1

process: support_triage

input:
  type: json

decisions:

  department:
    decide: one_of
    question: Which team should handle this ticket?
    options:
      billing: Payments, refunds, invoices
      support: Product problems and bugs
      sales: New purchases

  urgent:
    decide: whether
    question: Does this ticket require immediate attention?

  severity:
    decide: scale
    question: How severe is the customer impact?
    levels:
      - negligible
      - minor
      - significant
      - critical

flow:

  - when: urgent.probability >= 0.85
    do: return
    value:
      route: escalation

  - when: department.value == "billing"
    do: return
    value:
      route: billing

  - when: department.value == "sales"
    do: return
    value:
      route: sales

  - else:
      do: return
      value:
        route: support
```

## Example 2 — Warranty triage

```yaml
version: 1

process: warranty_triage

input:
  type: json

decisions:

  valid_claim:
    decide: whether
    question: Does this appear to be a legitimate warranty claim?

  issue:
    decide: one_of
    question: What is the most likely cause of the issue?
    options:
      manufacturing: Manufacturing defect
      shipping: Damage during shipping
      misuse: Damage caused by customer misuse
      unknown: Insufficient information

  severity:
    decide: scale
    question: How severe is the product damage?
    levels:
      - cosmetic
      - minor
      - significant
      - unusable

flow:

  - when: valid_claim.probability < 0.65
    do: return
    value:
      action: human_review

  - when: issue.value == "manufacturing"
    do: return
    value:
      action: approve_replacement

  - when: issue.value == "shipping"
    do: return
    value:
      action: shipping_claim

  - else:
      do: return
      value:
        action: human_review
```

---

# Phase 11 — Testing

Testing must not require downloading the Laya model for the main test suite.

Create a fake backend:

```ts
class FakeSystemOneBackend implements SystemOneBackend
```

Allow deterministic configured answers.

Use it for:

```text
parser tests
compiler tests
expression tests
flow tests
runtime tests
CLI tests where practical
```

Only have a separate optional integration test for real Laya.

Example:

```bash
LAYA_INTEGRATION=1 npm test
```

or separate:

```bash
npm run test:integration
```

## Required tests

### Parser

- valid workflow
- malformed YAML
- unsupported version
- missing process
- invalid decision kind
- `one_of` with one option
- `scale` with one level
- invalid flow rule

### Compiler

- `one_of` → `choice`
- `whether` → `noul`
- `scale` → `score`
- all decisions are compiled in one map

### Expression evaluator

- string equality
- string inequality
- numeric comparisons
- boolean comparisons
- unknown decision
- unsupported property
- invalid operator
- malformed literal

### Runtime

- all decisions sent in one backend call
- first matching rule wins
- else fallback works
- normalized decisions are exposed
- returned output is correct
- backend errors are surfaced cleanly

### Laya adapter

With mocked Laya response where possible:

- choice normalization
- noul normalization
- score normalization
- usage extraction
- close behavior

Real Laya integration test:

- model loads
- process executes
- result contains all decision IDs
- process returns a valid action

Do not assert exact probability values from the real model.

---

# Phase 12 — Errors

Create explicit error classes.

Suggested:

```ts
DslParseError
DslValidationError
ExpressionParseError
ExpressionEvaluationError
BackendError
RuntimeError
```

Errors shown in CLI should be concise.

Bad:

```text
TypeError: Cannot read properties of undefined...
```

Good:

```text
Invalid workflow:

flow[1].when references unknown decision "priority"

  priority.probability >= 0.8
  ^^^^^^^^
```

---

# Phase 13 — Logging / Diagnostics

Do not add a logging framework initially.

Support an optional runtime callback:

```ts
type RuntimeEvent =
  | { type: "inference:start"; decisionCount: number }
  | { type: "inference:end"; durationMs: number }
  | { type: "flow:match"; index: number }
  | { type: "flow:return"; value: unknown };
```

Runtime constructor can accept:

```ts
onEvent?: (event: RuntimeEvent) => void
```

CLI can use this for verbose mode:

```bash
banh run workflow.yaml --input input.json --verbose
```

---

# Phase 14 — Confidence Policy

Do **not** implement this before the basic runtime works.

Once core execution is stable, add optional confidence policy at decision level.

Example:

```yaml
decisions:

  department:
    decide: one_of
    question: Which team should handle this?
    options:
      billing: Payments and refunds
      support: Product issues

    confidence:
      minimum: 0.75
```

Possible normalized metadata:

```ts
interface DecisionPolicy {
  minimumConfidence?: number;
}
```

For the first implementation, failure should be exposed to the flow context:

```text
department.accepted
```

Example:

```yaml
flow:

  - when: department.accepted == false
    do: return
    value:
      route: human_review

  - else:
      do: return
      value:
        route: "{{ department.value }}"
```

Do not automatically retry or invoke another model in v0.

---

# Explicit Non-Goals for v0

Do not implement:

```text
Jev
OpenAI
Anthropic
generic LLM prompts
chat completion APIs
agent loops
tool planning
MCP
HTTP actions
email actions
queue actions
database actions
webhooks
durable waits
long-running processes
Temporal
Redis
Postgres
SQLite persistence
UI
workflow editor
multi-process daemon
distributed execution
authentication
cloud deployment
Docker orchestration
custom JavaScript
arbitrary shell execution
```

These features can come after the language/runtime proves useful.

The first milestone is a **local deterministic process runner powered by Laya decisions**.

---

# Architecture Rule

Maintain this dependency direction:

```text
CLI
 ↓
Runtime
 ↓
Compiler
 ↓
DSL

Runtime
 ↓
SystemOneBackend interface
 ↓
LayaBackend
 ↓
@receptron/laya
```

The following is forbidden:

```text
DSL → @receptron/laya
Compiler → @receptron/laya
Flow evaluator → @receptron/laya
```

Only the Laya adapter may import Laya.

---

# First Working Milestone

The first end-to-end success condition is:

```bash
banh run examples/support-triage.yaml \
  --input examples/inputs/support-ticket.json
```

and receive something like:

```json
{
  "process": "support_triage",
  "decisions": {
    "department": {
      "kind": "one_of",
      "value": "billing",
      "probability": 0.94
    },
    "urgent": {
      "kind": "whether",
      "value": false,
      "probability": 0.10
    },
    "severity": {
      "kind": "scale",
      "value": 1.4
    }
  },
  "output": {
    "route": "billing"
  }
}
```

All three decision questions must have been evaluated through **one** call to:

```ts
laya.systemOne(state, questions)
```

That batching behavior is an important property of the runtime.

---

# Suggested Implementation Order for Codex

Implement in this exact order.

## Step 1

Create project skeleton:

```text
package.json
tsconfig
src/
test/
examples/
```

Add dependencies and scripts.

Scripts:

```json
{
  "build": "tsc -p tsconfig.json",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "dev": "tsx src/cli/index.ts"
}
```

## Step 2

Implement DSL TypeScript types and Zod schemas.

Add parser tests.

Do not touch Laya yet.

## Step 3

Implement decision compiler.

Add compiler tests.

## Step 4

Implement expression tokenizer/parser/evaluator.

Add comprehensive expression tests.

Do not use `eval`.

## Step 5

Implement backend interface and fake backend.

## Step 6

Implement runtime using fake backend.

Prove one forward evaluation plus deterministic flow execution.

## Step 7

Implement `LayaBackend`.

Load once.

Batch all decision questions into one `systemOne` call.

Normalize response.

## Step 8

Implement CLI `validate`.

## Step 9

Implement CLI `run`.

## Step 10

Add example workflows and inputs.

## Step 11

Run:

```bash
npm run typecheck
npm test
npm run build
```

Fix all errors.

## Step 12

Perform a real Laya smoke test.

Do not change architecture to work around model behavior.

## Step 13

Add README with:

```text
what the project is
installation
first YAML example
validate command
run command
decision primitives
flow syntax
Laya requirements
limitations
```

## Step 14

Only after everything above works, add confidence policy and interpolation.

---

# Coding Guidelines for Codex

1. Prefer explicit, boring TypeScript over clever abstractions.
2. Keep exported interfaces documented.
3. Avoid premature generic provider abstractions beyond `SystemOneBackend`.
4. No dependency injection framework.
5. No decorators.
6. No runtime reflection.
7. No `any` unless wrapping unavoidable third-party values.
8. Use `unknown` at external boundaries.
9. Parse and validate before casting.
10. No use of `eval`.
11. No arbitrary code execution from YAML.
12. Tests must run without Laya model weights.
13. Real model integration tests must be optional.
14. Keep inference batching intact.
15. Do not silently coerce malformed YAML.
16. Surface model/backend failures rather than hiding them.
17. Do not make confidence thresholds appear universally meaningful; they must be configurable.
18. Do not add features not requested in this plan.

---

# Design Questions to Leave Open

Do not solve these in v0 unless needed:

```text
How should long-running persisted workflows work?
Should durability be implemented internally or delegated to Temporal?
How should events resume a process?
How should HTTP actions be sandboxed?
How should secrets be referenced?
How should retries work?
How should idempotency work?
How should multiple System One providers be selected?
How should System Two fallback work?
Should confidence thresholds use confidence, top probability, act probability, or calibrated policies?
How should workflows be versioned?
How should a cloud runtime execute workflows?
```

Keep interfaces clean enough that these remain possible later.

---

# Future Direction

After v0, the intended conceptual model is:

```text
rules
  ↓
System One
  ↓
System Two
  ↓
human
```

A future process might support:

```yaml
decisions:

  fraud:
    decide: whether
    question: Does this appear fraudulent?

    backend: fast

    fallback:
      backend: reasoning
      when_confidence_below: 0.65
```

And eventually:

```yaml
flow:

  - when: fraud.probability >= 0.9
    do: reject

  - when: fraud.confidence < 0.5
    do: human_review

  - wait:
      event: reviewer.completed
      timeout: 7d
```

But none of that belongs in the initial implementation.

---

# Definition of Done

Version 0 is done when all of the following are true:

- A YAML workflow can define `one_of`, `whether`, and `scale` decisions.
- YAML is parsed and validated with useful errors.
- Decision definitions compile into Laya-compatible questions.
- All decisions are evaluated in one Laya `systemOne` call.
- Laya output is normalized into provider-neutral `DecisionResult` objects.
- Deterministic flow expressions work without arbitrary code execution.
- A process can return a structured output.
- `banh validate` works without loading the model.
- `banh run` works against real Laya.
- Tests run without downloading Laya.
- An optional real-model integration test exists.
- The example support workflow runs end to end.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- No non-goal features were added.

The result should be small enough that the architecture remains obvious when reading the repository.
