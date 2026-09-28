# Banh

Alpha release: **0.1.0-alpha.1**. The CLI package is `@banh-dev/cli`;
libraries use the `@banh-dev` scope. The executable remains `banh`.
Install the alpha CLI with:

```sh
npm install --global @banh-dev/cli@alpha
banh --version
```

APIs and workflow syntax may change during alpha. Native Laya has been tested
with real inference on Linux. Real Kev-4B HTTP inference has also been verified.
Jev HTTP inference and hosted Cloud workflows have been verified in production.
HTTP Laya has fixture-based coverage; its live endpoint and native macOS/Windows
inference remain unverified.

A small TypeScript runtime and YAML language for bounded System One decisions,
followed by deterministic flow rules. A selected provider evaluates all decisions in one batch; Banh returns the first matching rule's value. There are no agent loops
or arbitrary code execution.

## Getting started

Requires Node.js 20 or newer and pnpm 10 (the version is pinned in package.json).

```sh
git clone https://github.com/banh-dev/banh.git
cd banh
pnpm install --frozen-lockfile
pnpm build
pnpm dev validate examples/support-triage.yaml
pnpm dev run examples/support-triage.yaml --input examples/inputs/support-ticket.json
```

For the compiled executable:

```sh
pnpm build
pnpm --dir packages/cli link --global
banh run examples/support-triage.yaml --input examples/inputs/support-ticket.json --json
```

`--json` writes one JSON execution result to stdout. `--verbose` writes runtime
events to stderr. Use the built executable for machine-readable output without
pnpm's script banners:

```sh
node packages/cli/dist/index.js run examples/support-triage.yaml --input examples/inputs/support-ticket.json --json
```

Validation and the default tests never load a model. The first native execution
downloads about 1.7 GB from Hugging Face, cached under `~/.cache/receptron-laya`
(or `LAYA_CACHE`). Allow roughly 2–3 GB of RAM. Inference runs locally on CPU;
Python and a separate model server are not required. The workspace explicitly allows the ONNX runtime and esbuild installation scripts.

`run` accepts `--model-dir <dir>` for an existing ONNX bundle, `--cache-dir <dir>`
for the download cache, and `--revision <rev>` to pin a model revision. A local
bundle includes `laya.onnx`, `laya.onnx.data`, `laya_config.json`,
`tokenizer/tokenizer.json`, and `tokenizer/tokenizer_config.json`.

## Inference providers

Native Laya remains the default. Workflows and flow rules are independent of
provider transport. Native execution supports Laya; HTTP execution supports
Laya, Kev, and Jev through one TypeSafe-compatible adapter.

A workflow can optionally select a logical model:

```yaml
model:
  provider: kev
  model: kev-4b
```

This uses the HTTP Kev preset for local `banh run`; configure its server with
`BANH_INFERENCE_BASE_URL` and optionally `BANH_INFERENCE_TOKEN`. Logical selections
currently supported by the CLI are `laya/laya`, `kev/kev-4b`, and `jev/jev-latest`. Jev also accepts `jev/jev-preview` and versioned IDs such as
`jev/jev-1.13.0`, which are forwarded to the HTTP API.
Explicit CLI flags and `BANH_PROVIDER`/`BANH_MODEL` take precedence for local testing.
An omitted selection preserves the native Laya default. Transport, endpoint, and credentials
stay outside the workflow. No automatic model fallback occurs.

To use an existing [Laya HTTP server](https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py):

```sh
banh run examples/support-triage.yaml --input examples/inputs/support-ticket.json \
  --provider http --model laya --base-url http://127.0.0.1:8000 --json
```

The HTTP adapter posts `{ state, questions }` to `/v1/systemone` and normalizes
the returned `answers` and `usage.input_tokens`, using the same translation as
native Laya. `--model` selects a model-family preset; `--model-id` supplies the
exact wire-level `model` field. Different models/checkpoints can produce
different predictions and confidence values.

| Model preset | Provider | Default base URL | Default wire model | Bearer token |
| --- | --- | --- | --- | --- |
| `laya` | native or http | Required for HTTP | Omitted (server routing) | Optional |
| `kev` | http | Required | `kev-latest` | Optional |
| `jev` | http | `https://api.typesafe.ai` | `jev-latest` | Required |

Selecting `--model jev` or `--model kev` defaults to HTTP; `--provider` can
override transport explicitly. OSS defaults remain native Laya when no model is selected.
Cloud owns its default and model allowlist independently.

Kev support targets [Jared Palmer's Kev](https://github.com/jaredpalmer/kev).
Jev uses the [official TypeSafe API](https://docs.typesafe.ai/api).
The model preset configures the request; the server controls which weights
actually execute. Providers retain their own request-size and option-count
limits and return errors when these are exceeded.

```sh
# Self-hosted Kev
banh run examples/support-triage.yaml --input examples/inputs/support-ticket.json \
  --provider http --model kev --base-url http://127.0.0.1:8008

# Hosted Jev; set BANH_INFERENCE_TOKEN to your TypeSafe API key first
banh run examples/support-triage.yaml --input examples/inputs/support-ticket.json \
  --provider http --model jev

# Pin a Laya server checkpoint
banh run examples/support-triage.yaml --input examples/inputs/support-ticket.json \
  --provider http --model laya --base-url http://127.0.0.1:8000 --model-id multilingual
```

| Flag | Environment | Default |
| --- | --- | --- |
| `--provider` | `BANH_PROVIDER` | `native` |
| `--model` | `BANH_MODEL` | `laya` |
| `--base-url` | `BANH_INFERENCE_BASE_URL` | Model preset default (see above) |
| `--model-id` | `BANH_INFERENCE_MODEL_ID` | Model preset default (see above) |
| `--timeout-ms` | `BANH_INFERENCE_TIMEOUT_MS` | `60000` |
| — | `BANH_INFERENCE_TOKEN` | No authentication; required for Jev |

Flags override environment variables, which override preset defaults. Supply the bearer token through
`BANH_INFERENCE_TOKEN`. These settings apply to `banh run`.

The base URL may include a reverse-proxy prefix or end in `/v1`. For example,
`https://host/models/laya` and `https://host/models/laya/v1/` both target
`https://host/models/laya/v1/systemone`. Query strings, fragments, and embedded
credentials are rejected. HTTP and HTTPS are supported; requests do not follow
redirects. Retries are off by default; library callers can set `maxAttempts: 2`
for connection failures and 502/503/504 responses. One total timeout covers both
attempts, backoff, and response reading. Per-run `AbortSignal` cancellation is
supported by HTTP execution. Closing the
HTTP provider aborts active requests without shutting down the remote server.

Native options `--model-dir`, `--cache-dir`, and `--revision` cannot be used
with HTTP. `--model-id` is HTTP-only. HTTP execution never loads the native SDK or downloads weights,
although this workspace still installs the native dependency. Standalone HTTP
consumers can depend on `@banh-dev/typesafe` and construct `TypeSafeHttpBackend`
with `baseUrl`, optional `modelId`, `token`, and `timeoutMs`; that package
has no native inference dependency.

Library callers can select a provider explicitly:

```ts
import { createProvider } from "@banh-dev/providers";
import { ProcessRuntime } from "@banh-dev/runtime";

const backend = await createProvider({
  provider: "http",
  model: "laya",
  options: { baseUrl: "http://127.0.0.1:8000", timeoutMs: 60_000 },
});
try {
  const result = await new ProcessRuntime(backend).execute(definition, input);
} finally {
  await backend.close();
}
```

Calling `createProvider()` selects native Laya. Existing direct
`LayaBackend.create()` calls remain supported.

## Banh Cloud

[Banh Cloud](https://docs.banh.dev/getting-started/cloud/) is an **early release**
with managed Jev inference. Access is currently by invitation. Once admitted,
use `banh login`, `banh deploy <workflow.yaml>`, and `banh invoke <workflow>`.
Cloud commands default to `https://api.banh.dev`; no separate model API key is needed.

Starter is USD **$4.99/month** for **2,000 completed runs**; Pro is USD
**$19.99/month** for **10,000**. Both have an approximate **8,000-token** budget
per request, including decision questions and options. Failed runs do not consume
allowance. See the [Cloud guide](https://docs.banh.dev/getting-started/cloud/)
for access, billing, limits, and automation credentials.

Account billing owners can use `banh billing status` to view allowance and period
boundaries, and `banh billing cancel` to stop renewal at the end of the current
paid period. Cancellation also works with a scheduled downgrade; paid access
continues until the displayed end date. Repeating the command is safe.
Use `--json` for machine-readable billing status.

## Workflow syntax

```yaml
version: 1
process: urgent_routing
input:
  type: json
decisions:
  urgent:
    decide: whether
    question: Does this ticket require immediate attention?
flow:
  - when: urgent.probability >= 0.85
    do: return
    value:
      route: escalation
  - else:
      do: return
      value:
        route: support
```

The primitives are `one_of` (at least two named options), `whether` (a boolean
with P(true)), and `scale` (at least two ordered levels). Scale values are
fractional, zero-based expected rubric positions. Whether values are true when
the probability is at least 0.5. Raw answers and distributions are preserved.
See `examples/` for support routing, warranty triage, and their JSON inputs.

Flow expressions compare one decision's `value`, `probability`, or `confidence`
with a JSON string, finite number, or boolean. Supported comparisons are `==`,
`!=`, `>`, `>=`, `<`, and `<=`; ordered comparisons require numbers. Strings use
double quotes. Decision IDs use letters, digits, and underscores, starting with
a letter or underscore. `scale.probability` is unavailable. Reading absent
metadata is an explicit error; Laya's whether answers do not provide confidence.

Rules execute in order, and the first match returns. An optional `else` must
appear last; if nothing matches, execution fails with a clear error. Return
values are JSON-compatible. Unknown fields, duplicate keys, non-string mapping
keys, YAML aliases, and unsupported expressions are rejected.

`input.type` can be `json` or `text`. `--input` parses JSON unless the workflow
explicitly declares text, in which case it reads the file verbatim. `--text`
accepts literal text for text workflows or workflows without an input type.
Missing input types permit either JSON-compatible state or text.

## Interpolation and confidence policy

An entire return-value string can reference a decision result. Interpolation
works recursively in objects and arrays, and preserves numbers and booleans:

```yaml
value:
  route: "{{ department.value }}"
  probability: "{{ department.probability }}"
```

Partial strings such as `"Route to {{ department.value }}"` are rejected.
Unknown references are rejected during validation; unavailable metadata raises
an error when the return executes.

Decisions can optionally declare `confidence: { minimum: 0.75 }`. The runtime
then exposes `department.accepted`, which can be used in a rule such as
`department.accepted == false` to return a human-review route. The result is
accepted when confidence meets the inclusive threshold; missing confidence
fails the policy. Without a policy, `accepted` is true. Thresholds are specific
to your workflow, not universal quality guarantees. Laya's whether answers
lack confidence, so use their probability directly instead. No policy causes
a retry or a second inference call.

## Library usage

```ts
import { readFile } from "node:fs/promises";
import { parseProcess } from "@banh-dev/dsl";
import { ProcessRuntime } from "@banh-dev/runtime";
import { LayaBackend } from "@banh-dev/laya";

const definition = parseProcess(await readFile("examples/support-triage.yaml", "utf8"));
const input = JSON.parse(await readFile("examples/inputs/support-ticket.json", "utf8"));
const backend = await LayaBackend.create();
try {
  const runtime = new ProcessRuntime(backend);
  console.log(await runtime.execute(definition, input));
  // Reuse the same runtime/backend for more inputs.
} finally {
  await backend.close();
}
```

The caller owns the backend lifetime. The CLI closes it even if execution fails.
`new ProcessRuntime(backend, { onEvent })` provides inference and flow events.
Execution timing excludes model loading; inference timing includes backend
normalization. No fallback provider, retries, or side-effect actions are included.

Laya's English checkpoint has a limited context window (512 tokens, including
question headers); long input may be truncated. Keep choice lists small.
See the [Laya documentation](https://github.com/receptron/laya#readme) for model
requirements and limits.

## Development

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

The integration test is opt-in and uses real weights. Set `LAYA_MODEL_DIR` to use
an existing bundle. All other tests use fake or mocked backends. Vitest stays on
major version 4, with Vite 6 selected to retain Node 20 compatibility. Build
output lives in each package’s `dist/` directory and is ignored by Git. Tests
run against the built public package exports; test commands build first. Rebuild
the packages when using watch mode after changing library code.

## Repository layout

- `packages/dsl` — `@banh-dev/dsl`: YAML parsing, validation, expressions, and compilation.
- `packages/runtime` — `@banh-dev/runtime`: backend contract, execution, and normalized results.
- `packages/laya` — `@banh-dev/laya`: native Laya and compatibility exports.
- `packages/typesafe` — `@banh-dev/typesafe`: shared TypeSafe HTTP adapter and protocol translation.
- `packages/providers` — `@banh-dev/providers`: provider configuration and model selection.
- `packages/cli` — `@banh-dev/cli`: workflow validation and local execution.
- `test` — deterministic tests and an opt-in real-model test.

## Alpha release and licensing

Bánh code is [MIT licensed](LICENSE). Model weights and dependencies retain their
own licenses; model weights are downloaded separately and are not included in npm
artifacts. Native inference dependencies are installed with the CLI even when you
only use HTTP. HTTP-only library users can install `@banh-dev/typesafe` from npm.

See [release preparation](RELEASING.md) and [changes](CHANGELOG.md). Release
artifacts must pass a clean npm installation test outside the workspace.
