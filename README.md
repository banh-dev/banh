# Banh

User guides are maintained in the sibling [Banh documentation site](../banh-docs/README.md).
Start with the [local quickstart](../banh-docs/src/content/docs/getting-started/quickstart.md).

A small TypeScript runtime and YAML language for bounded System One decisions,
followed by deterministic flow rules. A selected provider evaluates all decisions in one batch; Banh returns the first matching rule's value. There are no agent loops
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
provider selection. Native execution supports Laya; HTTP execution supports
Laya, Kev, and Jev through one TypeSafe-compatible adapter.

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
`BANH_INFERENCE_TOKEN`; it is separate from cloud login credentials and
`BANH_API_TOKEN`. These settings apply to `run`, not cloud `invoke`.

The base URL may include a reverse-proxy prefix or end in `/v1`. For example,
`https://host/models/laya` and `https://host/models/laya/v1/` both target
`https://host/models/laya/v1/systemone`. Query strings, fragments, and embedded
credentials are rejected. HTTP and HTTPS are supported; requests do not follow
redirects or retry. The timeout includes reading the response body. Closing the
HTTP provider aborts active requests without shutting down the remote server.

Native options `--model-dir`, `--cache-dir`, and `--revision` cannot be used
with HTTP. `--model-id` is HTTP-only. HTTP execution never loads the native SDK or downloads weights,
although this workspace still installs the native dependency. Standalone HTTP
consumers can depend on `@banh/typesafe` and construct `TypeSafeHttpBackend`
with `baseUrl`, optional `modelId`, `token`, and `timeoutMs`; that package
has no native inference dependency.

Library callers can select a provider explicitly:

```ts
import { createProvider } from "@banh/providers";
import { ProcessRuntime } from "@banh/runtime";

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

## Local cloud workflow (M3)

You can complete login and deployment locally with the sibling `banh-cloud` project.
No public service or production deployment is needed.

First, in `banh-cloud`:

```sh
make migrate
make up
# Configure Auth0; see banh-cloud/AUTH0.md.
```

Configure a development Auth0 tenant using `banh-cloud/AUTH0.md`. Developer login
uses Auth0 device authorization and creates a personal Banh account on first login.
Existing accounts are reused; manual provisioning is optional.

Then, from this repository:

```sh
pnpm build
node packages/cli/dist/index.js login --api-url http://127.0.0.1:3000
# Authorize the displayed user code in your browser.
node packages/cli/dist/index.js whoami
node packages/cli/dist/index.js deploy examples/warranty-claim.yaml
node packages/cli/dist/index.js invoke warranty_triage --input examples/inputs/warranty-claim.json --json
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
uses Laya by default; an explicit fake backend remains available for tests.

### Cloud billing

Cloud invocation requires a paid subscription (currently Stripe sandbox only).
Local `banh run` remains free and does not contact billing.

```sh
node packages/cli/dist/index.js billing status
node packages/cli/dist/index.js billing checkout starter
node packages/cli/dist/index.js billing plan pro
node packages/cli/dist/index.js billing portal
```

Open the printed Stripe URL for Checkout or payment/cancellation management. Status
supports `--json` and reports used, reserved, remaining runs, and the period end.
See `banh-cloud/BILLING.md` for local setup. Only the account billing owner can
manage payment; account developers can view usage. No overages are charged.

### Run history

```sh
node packages/cli/dist/index.js runs warranty_triage --limit 10
node packages/cli/dist/index.js inspect run_YOUR_RUN_ID --json
```

`runs` lists newest first with status, version, duration, and creation time. Use
`--limit` (1–100, default 50) and `--offset` (0–10000, default 0) for pagination.
`inspect` includes stored input, decisions/probabilities, output, trace, and errors.
Both commands support `--json` and `--api-url` and require developer login;
invocation keys cannot read history. Inspecting a failed run exits successfully;
missing records, invalid input, and authorization errors exit nonzero.

### Configuration

Until a login is saved, the default API is `http://127.0.0.1:3000`. Cloud commands
accept an origin or a URL ending in `/v1`. Remote endpoints require HTTPS; HTTP is
accepted for loopback hosts. Requests do not follow redirects.

Resolution order for cloud settings:

- API URL: `--api-url`, then `BANH_API_URL`, then saved URL, then the local default.
- Token: `BANH_API_TOKEN`, then the saved token for that exact API URL.
- Account: `BANH_ACCOUNT_ID`, otherwise an account belonging to the verified Auth0 identity.

The lowercase-prefix aliases `banh_API_URL`, `banh_API_TOKEN`, and
`banh_ACCOUNT_ID` from the implementation plan also work; uppercase names take
precedence. Changing the API URL does not forward a saved token to a different
server. Environment tokens can be used by `whoami` and `deploy` without logging
in or writing credentials, which is useful in CI.

Login discovers Auth0 settings from `/v1/auth/config`, opens the browser, and polls
for an access token. `--no-browser` prints instructions without launching a browser.
No client secret is used. Login validates the token with `/v1/me` before saving it. Credentials are stored
in a local JSON file with owner-only permissions on Unix:

- Linux: `$XDG_CONFIG_HOME/banh/config.json` or `~/.config/banh/config.json`.
- macOS: `~/Library/Application Support/banh/config.json`.
- Windows: `%APPDATA%/banh/config.json`.

`BANH_CONFIG_DIR` selects a separate Banh configuration directory for isolated
profiles or tests. Saved credentials are plaintext in that private file; they
are not stored in an OS keychain. `logout` removes the saved login locally. It
does not revoke the access token, end the browser's Auth0 SSO session, or unset
environment variables. This revision does not store refresh tokens: repeat login
when the access token expires. `BANH_API_TOKEN` must be a valid Auth0 user access
token for the configured API/client; old `banh_dev_...` credentials no longer work.

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
- `packages/laya` — `@banh/laya`: native Laya and compatibility exports.
- `packages/typesafe` — `@banh/typesafe`: shared TypeSafe HTTP adapter and protocol translation.
- `packages/providers` — `@banh/providers`: provider configuration and model selection.
- `packages/cli` — `banh`: local commands and cloud login/logout/whoami/deploy.
- `test` — deterministic tests and an opt-in real-model test.

The private `banh-cloud` repository is a sibling checkout. It imports these
packages instead of implementing another runtime. Build this workspace before
installing or running cloud locally. See [ARCHITECTURE.md](ARCHITECTURE.md).

Packages remain private until the OSS release milestone; nothing is published yet.
[PLAN.md](PLAN.md) is the original local-runtime design. The broader Banh v0 plan
adds hosted execution; see [PROGRESS.md](PROGRESS.md) for the current scope.
