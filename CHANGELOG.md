# Changelog

## 0.1.0-alpha.0 — release candidate, not published

- YAML workflows with bounded `one_of`, `whether`, and `scale` decisions followed
  by deterministic flow rules, interpolation, and confidence policies.
- Native Laya execution and experimental TypeSafe-compatible HTTP execution for
  Laya, Kev, and Jev. Configurable model IDs, endpoints, authentication, and timeouts.
- Local validate/run commands and optional cloud login, deployment, invocation,
  billing, and run-history commands. Cloud defaults to `https://api.banh.dev`.
- MIT licensing and six independently packed packages.
- Validate complete probability distributions with a tolerance for rounding;
  reject malformed cloud invocation results.
- CLI `--version`, artifact installation smoke test, and Linux CI for Node 20/22/24.

Alpha APIs and workflow syntax may change. Cloud remains an invitation-only pilot.
Native inference cannot be forcibly cancelled through the backend interface.
Live HTTP model integration and non-Linux platforms have not yet been verified.
