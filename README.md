# Banh

A small TypeScript runtime and YAML language for bounded System One decisions,
followed by deterministic flow rules. Laya evaluates all decisions in one model
call; Banh returns the first matching rule's value. There are no agent loops
or arbitrary code execution.

## Getting started

Requires Node.js 20 or newer and pnpm 10 (the version is pinned in package.json).

```sh
pnpm install
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

Validation and the default tests never load a model. The first real execution
downloads about 1.7 GB from Hugging Face, cached under `~/.cache/receptron-laya`
(or `LAYA_CACHE`). Allow roughly 2–3 GB of RAM. Inference runs locally on CPU;
Python and a separate model server are not required. The workspace explicitly allows the ONNX runtime and esbuild installation scripts.

`run` accepts `--model-dir <dir>` for an existing ONNX bundle, `--cache-dir <dir>`
for the download cache, and `--revision <rev>` to pin a model revision. A local
bundle includes `laya.onnx`, `laya.onnx.data`, `laya_config.json`,
`tokenizer/tokenizer.json`, and `tokenizer/tokenizer_config.json`.

## Local cloud workflow (M3)

You can complete login and deployment locally with the sibling `banh-cloud` project.
No public service or production deployment is needed.

First, in `banh-cloud`:

```sh
make migrate
make up
make provision
```

Provisioning prints a **developer token** (`banh_dev_...`) and a separate invocation
API key (`banh_sk_...`). Use the developer token for CLI login.

Then, from this repository:

```sh
pnpm build
node packages/cli/dist/index.js login --api-url http://127.0.0.1:3000
# Paste the developer token at the hidden prompt.
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js deploy examples/warranty-claim.yaml
node packages/cli/dist/index.js logout
```

If you have linked the CLI globally, use `banh` in place of
`node packages/cli/dist/index.js`. `pnpm dev login`, `pnpm dev whoami`, and
`pnpm dev deploy examples/warranty-claim.yaml` work too.

`deploy` parses, validates, and compiles the YAML locally before authenticating
and uploading. Every successful deploy creates a new version, even for unchanged
source. It prints the version and invocation endpoint. `whoami` and `deploy`
support `--json`; use the compiled executable for clean machine-readable stdout.
Neither command loads Laya.

**Here, deploy means uploading YAML to your local Banh Cloud database.** It does
not deploy infrastructure or publish anything on the internet. Cloud execution
still uses the explicitly labeled fake backend until M4. Local `banh run` uses Laya.

### Configuration

Until a login is saved, the default API is `http://127.0.0.1:3000`. Cloud commands
accept an origin or a URL ending in `/v1`. Remote endpoints require HTTPS; HTTP is
accepted for loopback hosts. Requests do not follow redirects.

Resolution order for cloud settings:

- API URL: `--api-url`, then `BANH_API_URL`, then saved URL, then the local default.
- Token: `BANH_API_TOKEN`, then the saved token for that exact API URL.
- Account: `BANH_ACCOUNT_ID`, otherwise the account identified by the developer token.

The lowercase-prefix aliases `banh_API_URL`, `banh_API_TOKEN`, and
`banh_ACCOUNT_ID` from the implementation plan also work; uppercase names take
precedence. Changing the API URL does not forward a saved token to a different
server. Environment tokens can be used by `whoami` and `deploy` without logging
in or writing credentials, which is useful in CI.

Login validates the token with `/v1/me` before saving it. Credentials are stored
in a local JSON file with owner-only permissions on Unix:

- Linux: `$XDG_CONFIG_HOME/banh/config.json` or `~/.config/banh/config.json`.
- macOS: `~/Library/Application Support/banh/config.json`.
- Windows: `%APPDATA%/banh/config.json`.

`BANH_CONFIG_DIR` selects a separate Banh configuration directory for isolated
profiles or tests. Saved credentials are plaintext in that private file; they
are not stored in an OS keychain. `logout` removes the saved login locally. It
does not revoke the server-issued token or unset environment variables.

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
import { parseProcess } from "@banh/dsl";
import { ProcessRuntime } from "@banh/runtime";
import { LayaBackend } from "@banh/laya";

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

- `packages/dsl` — `@banh/dsl`: YAML parsing, validation, expressions, and compilation.
- `packages/runtime` — `@banh/runtime`: backend contract, execution, and normalized results.
- `packages/laya` — `@banh/laya`: Laya loading and answer normalization.
- `packages/cli` — `banh`: local commands and cloud login/logout/whoami/deploy.
- `test` — deterministic tests and an opt-in real-model test.

The private `banh-cloud` repository is a sibling checkout. It imports these
packages instead of implementing another runtime. Build this workspace before
installing or running cloud locally. See [ARCHITECTURE.md](ARCHITECTURE.md).

Packages remain private until the OSS release milestone; nothing is published yet.
[PLAN.md](PLAN.md) is the original local-runtime design. The broader Banh v0 plan
adds hosted execution; see [PROGRESS.md](PROGRESS.md) for the current scope.
