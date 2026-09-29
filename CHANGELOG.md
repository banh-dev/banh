# Changelog

## 0.1.0-alpha.1 — 2026-09-28

- Support versioned Jev model IDs and `jev-preview` in workflow YAML; explicit
  CLI/environment model IDs still override workflow selections.
- Create, list and revoke account invocation keys with `banh keys`.
- Cancel renewal with `banh billing cancel`, including when a Cloud downgrade
  is scheduled, while preserving access through the current paid period.
- Explain hosted input limits, unpaid subscriptions, quota limits and temporary
  inference cooldowns through CLI errors.
- Document Banh Cloud as an early release with managed Jev, current plans and
  invitation-based access. OSS provider selection remains independent of Cloud.


## 0.1.0-alpha.0 — 2026-09-28

- YAML workflows with bounded `one_of`, `whether`, and `scale` decisions followed
  by deterministic flow rules, interpolation, and confidence policies.
- Native Laya execution and experimental TypeSafe-compatible HTTP execution for
  Laya, Kev, and Jev. Configurable model IDs, endpoints, authentication, and timeouts.
- Local validate/run commands and optional cloud login, deployment, invocation,
  billing, and run-history commands. Cloud defaults to `https://api.banh.dev`.
- Optional logical provider/model selection in workflow YAML, resolved by the CLI
  or the Cloud managed-model allowlist.
- HTTP cancellation, bounded opt-in retries, structured provider errors, request
  diagnostics, and input/output token usage.
- MIT licensing and six independently packed packages under `@banh`, including
  `@banh/cli` with the `banh` executable.
- Validate complete probability distributions with a tolerance for rounding;
  reject malformed cloud invocation results.
- CLI `--version`, artifact installation smoke test, and Linux CI for Node 20/22/24.

Alpha APIs and workflow syntax may change. Cloud remains an invitation-only pilot.
Native inference cannot be forcibly cancelled through the backend interface.
Real Kev-4B HTTP inference has been verified, including hosted execution and
a cached cold start. Real HTTP Laya/Jev endpoints and non-Linux native platforms
have not yet been verified.
