# Implementation progress

The original local-runtime implementation in PLAN.md is complete. This covers
M1 of the broader Banh implementation plan, not the complete hosted v0.

## M3 — Auth0 revision

- Replaced manual developer login with Auth0 device authorization. The CLI discovers
  public tenant settings, displays a verification code, opens the browser, polls
  at the provider interval, and handles denial, expiry, cancellation, and slow-down.
- Cloud verifies RS256/JWKS, issuer, audience, expiry, and client ID.
  Verified issuer/subject maps to explicit Banh account membership, never email.
- Added an identity migration retiring old developer tokens while preserving
  accounts, deployments, versions, history, and invocation API keys.
- Access tokens are stored privately and bound to the API URL; no client secret
  or refresh token is stored. Expiry requires another login in this first revision.
- Setup lives in `banh-cloud/AUTH0.md`; the original implementation plan now
  specifies Auth0 for developer authentication.
- Real browser sign-in needs the user's Auth0 tenant identifiers. Local tests use
  signed JWTs, a JWKS fixture, mocked device flow, and isolated Postgres schemas.
- Verification: 151 OSS tests and 30 cloud tests passed, including Docker builds,
  typechecks, signed JWT/JWKS tests, and real-Postgres API tests. The real-model
  integration test remains opt-in. Migration 002 was applied locally.
- Local services are healthy. Auth0 discovery returns a configuration-required
  response until the tenant identifiers are supplied; real sign-in is unverified.
- M4: cloud Laya execution and `banh invoke` are implemented for local Docker use.

## Package extraction and cloud foundation

- Split the OSS code into `@banh/dsl`, `@banh/runtime`, `@banh/laya`, and `banh`.
- Added a pnpm workspace, package builds, and public package imports in tests.
- Created a separate sibling `banh-cloud` repository with a Fastify health endpoint
  and a backend-injected execution service using the shared runtime.
- Cloud execution collects decisions and the matched rule for a future persisted trace.
- M2 is now implemented in the sibling cloud repository: Postgres migrations,
  hashed invocation keys, Auth0 identity/account authorization, immutable workflow versions, and
  persisted run APIs using the shared runtime with a fake backend.
- M2 verification passed on the host and inside Docker: 15 cloud tests including
  12 real-Postgres API tests, plus all 115 OSS tests (real-model test skipped).
- Local database migration was explicitly applied; Docker app and Postgres are
  healthy, and `/ready` reports database/schema readiness.
- M3 now adds CLI login/logout/whoami/deploy, private local credential storage,
  API-bound saved tokens, environment overrides, local pre-upload compilation,
  and an end-to-end CLI test against local HTTP and Postgres.
- Production deployment remains
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

The initial implementation is committed. Subsequent milestones below describe
the local cloud and CLI integration.

## M4 local verification

- `banh invoke` supports JSON files, text input, saved login, invocation keys,
  structured results, and nonzero exit on failed runs.
- Docker defaults to a shared CPU Laya instance with a persistent model cache.
- 155 OSS tests and 35 cloud tests pass, including Postgres-backed CLI invocation.
- Real Docker HTTP invocation of warranty_triage v1 returned human_review in
  approximately 316 ms, with backend=laya; the persisted run was read back via API.
- Hard inference cancellation and production worker isolation remain future work.

## M5 — CLI observability

- Added `banh runs` with validated limit/offset pagination and readable tables.
- Added `banh inspect` for stored inputs, decisions, output, traces, and errors.
- Both use developer authentication and support JSON output and API overrides.
- 161 OSS tests and Postgres-backed CLI checks cover history, inspection,
  empty pages, malformed responses, missing runs, and denied access.
