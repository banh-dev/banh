# Package boundaries

The public OSS repository contains four packages:

```text
banh (CLI) ──────┬── @banh/dsl
                ├── @banh/runtime ── @banh/dsl
                └── @banh/laya ───── @banh/runtime + @banh/dsl
                         └───────── @receptron/laya
```

The DSL owns parsing, schema validation, expression ASTs, and question compilation.
The runtime owns normalized result types and the `SystemOneBackend` interface.
The Laya package implements that interface. Only the Laya package imports the SDK.
The CLI handles files, flags, output, and backend lifecycle.

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
