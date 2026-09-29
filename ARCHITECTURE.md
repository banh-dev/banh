# Package boundaries

The public OSS repository contains six packages:

```text
banh (CLI) ──────┬── @banh/dsl
                ├── @banh/runtime ── @banh/dsl
                └── @banh/providers
                       ├── native: @banh/laya ── @receptron/laya (lazy)
                       │                └── @banh/typesafe (translation)
                       └── HTTP: @banh/typesafe ── Laya / Kev / Jev APIs
```

The DSL owns parsing, schema validation, expression ASTs, and question compilation.
Compiled questions use Bánh's `one_of` / `whether` / `scale` vocabulary, with
`question`, `options`, and `levels` fields. The runtime owns normalized result
types and the `SystemOneBackend` provider interface. It validates results,
applies confidence policies, and evaluates flow rules independently of the model.

The TypeSafe package owns the shared `choice` / `noul` / `score` protocol,
request translation, answer normalization, and `TypeSafeHttpBackend`. The HTTP
implementation sends one batch to an existing server with optional bearer
authentication, an optional exact model ID, and a bounded timeout. It has no
dependency on the Laya package or native SDK. Optional answer metadata remains
optional; supplied confidence is preserved rather than recomputed.

The Laya package implements native execution and uses the same protocol
translation. Only native creation imports the SDK. Previous `LayaHttpBackend`,
`toLayaQuestions`, and `normalizeLayaEvaluation` exports remain as compatibility
aliases to the shared implementation. Protocol errors now use TypeSafe wording.
Neither provider retries or falls back to another model.

The providers package selects native execution or shared HTTP execution.
HTTP supports `laya`, `kev`, and `jev` presets. Kev defaults the request model
to `kev-latest`; Jev defaults to `jev-latest`, uses `https://api.typesafe.ai`,
and requires an inference token. Laya omits the model field unless overridden,
preserving server-default routing. Laya and Kev require an explicit server URL.
The preset's `model` is separate from `options.modelId`, which passes the
exact model/checkpoint identifier to the server.

To add another compatible HTTP model, extend the preset configuration and
contract tests. For a different protocol or native engine, implement
`SystemOneBackend` in a separate adapter and extend the factory/configuration
union. Workflow syntax and flow evaluation remain unchanged. Server limits
are enforced by each endpoint; compatibility does not imply identical limits,
calibration, or predictions.

The CLI handles files, flags, output, provider selection, and backend lifecycle.
Provider settings are execution configuration, outside workflow YAML. Cloud
credentials are never reused for inference authentication.

### Backend migration

Custom backends must accept the new Bánh question shape instead of the old
Laya-shaped `SystemOneQuestion`. Normalized results and `evaluate`/`close`
signatures are unchanged. Workflow YAML and direct `LayaBackend.create()` usage
remain compatible. The CLI's injectable `createBackend` now receives
`ProviderOptions` rather than `LayaBackendOptions`.

Cross-package imports use public package exports. The DSL and runtime have no
Laya dependency. Consumers build packages in dependency order with `pnpm build`.
The deterministic tests use those same compiled exports, with fake model results.

`banh-cloud` is a separate private repository. During local development, it uses
`link:` dependencies pointing at this sibling checkout. These are temporary local
references; before a standalone cloud build/deployment, replace them with published
versions or install packed OSS artifacts. Do not copy runtime source into cloud.

A service creates a backend once, shares it across executions, and closes it at
shutdown. The local CLI creates and closes a backend for its one execution.
Model loading remains explicit and outside workflow execution timing.

The old `PLAN.md` describes the original local runtime. The workspace-level
`banh-implementation-plan.md` describes the broader local-and-hosted v0 roadmap.
