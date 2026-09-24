# Implementation progress

The original local-runtime implementation in PLAN.md is complete. This covers
M1 of the broader Banh implementation plan, not the complete hosted v0.

## Package extraction and cloud foundation

- Split the OSS code into `@banh/dsl`, `@banh/runtime`, `@banh/laya`, and `banh`.
- Added a pnpm workspace, package builds, and public package imports in tests.
- Created a separate sibling `banh-cloud` repository with a Fastify health endpoint
  and a backend-injected execution service using the shared runtime.
- Cloud execution collects decisions and the matched rule for a future persisted trace.
- M2 is now implemented in the sibling cloud repository: Postgres migrations,
  hashed credentials, account authorization, immutable workflow versions, and
  persisted run APIs using the shared runtime with a fake backend.
- M2 verification passed on the host and inside Docker: 15 cloud tests including
  12 real-Postgres API tests, plus all 115 OSS tests (real-model test skipped).
- Local database migration was explicitly applied; Docker app and Postgres are
  healthy, and `/ready` reports database/schema readiness.
- M3 now adds CLI login/logout/whoami/deploy, private local credential storage,
  API-bound saved tokens, environment overrides, local pre-upload compilation,
  and an end-to-end CLI test against local HTTP and Postgres.
- Real hosted Laya, CLI invoke/run inspection, and production deployment remain
  unimplemented.

Package extraction verification:

- `pnpm typecheck`: passed for all packages and tests.
- `pnpm test`: 115 passed; 1 real-model integration test skipped.
- Compiled CLI validated the warranty example successfully.
- Cloud `pnpm typecheck`, `pnpm test` (3 tests), and `pnpm build`: passed.

The verification below records the original implementation checks, including the
historical real-Laya run; real inference was not rerun for package extraction.

## Implemented

- ESM TypeScript package with strict types, build scripts, and a local Git repository.
- Strict YAML parsing, schema validation, and useful field-path errors.
- `one_of`, `whether`, and `scale` compilation into one question map.
- Restricted expressions with reference/type validation and no executable code.
- Provider-neutral backend interface and a deterministic fake backend for tests.
- Runtime input validation, one backend call per execution, ordered first-match
  returns, optional else fallback, explicit no-match errors, usage, and timing.
- Optional inference/flow diagnostic events.
- Laya adapter with lazy loading, instance reuse, answer validation/normalization,
  original raw answers, token usage, and explicit cleanup.
- `banh validate` and `banh run`, JSON or text input, JSON output, verbose
  stderr diagnostics, and local model/cache/revision options.
- Both example workflows and input files.
- Recursive whole-value interpolation preserving primitive types.
- Configurable confidence minimums and `accepted` flow results without retries.
- README covering installation, CLI/library usage, syntax, and limitations.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 115 tests passed; real-model test skipped by default.
- `npm run build`: passed.
- `npm run test:integration`: real Laya support workflow passed.
- Compiled support CLI smoke test returned `route: billing` and all three answers.
- Compiled warranty CLI smoke test returned `action: human_review` and all three
  answers; output parsed as JSON successfully.
- Only the Laya adapter imports `@receptron/laya`.

The model was downloaded and cached under `~/.cache/receptron-laya`. Native ONNX
inference worked in this environment without additional installation changes.
Exact model probabilities and routes are not asserted in the integration test.

## Deliberate semantics

- Model loading is outside runtime timing; inference includes normalization.
- A missing optional result property raises an error when read.
- A configured confidence policy fails if confidence is absent; Laya whether
  answers expose probability but no confidence. No policy means accepted=true.
- Unknown template references and partial-string interpolation are rejected
  before inference. Only returned values are interpolated, never object keys.
- The library caller owns backend cleanup; CLI runs always close their backend.
- External actions, additional providers, retries, and agent loops remain out of scope.

Git has no initial commit yet: author identity was not configured during repository
setup. Implementation files are available locally; no remote repository was created.
