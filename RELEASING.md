# Preparing the alpha

Target version: `0.1.0-alpha.0`. npm dist-tag: `alpha`, never `latest` for this release.
The workspace root stays private; the six packages carry MIT licenses and public
publish metadata. **Publication is blocked until package-name ownership is resolved.**
The current `banh` name and `@banh` scope are provisional. Confirm ownership or rename
all manifests/imports and repeat verification before uploading anything. Do not
publish to an unrelated name as a shortcut.

## Local verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm release:check
# Keep tarballs for review instead of deleting temporary artifacts:
pnpm release:check artifacts/alpha
```

The release check packs all six packages, installs them together with npm in a
fresh temporary directory, verifies exact internal versions, MIT files, public
exports, the executable and version, YAML validation, and an HTTP workflow against
a local fixture. It never publishes, contacts Cloud, or downloads model weights.
It does download npm dependencies; optional ONNX GPU downloads are disabled during
this check. It currently requires a POSIX environment.

Run native integration separately with an existing model bundle:

```sh
LAYA_MODEL_DIR=/path/to/model pnpm test:integration
```

Before claiming verified HTTP support, test the documented workflows against real
Laya/Kev endpoints and an authorized Jev account. Do not make paid inference calls
as part of routine CI. GitHub CI covers Linux and Node 20/22/24; native platform
coverage remains separate. Package builds use pnpm, which rewrites `workspace:*`
references to exact alpha versions in packed manifests. Do not use plain npm pack
on the unconverted workspace source.

## Publication checklist

1. Resolve the npm package names/scope and authenticate through local npm tooling.
2. Review and commit changes; ensure CI and clean-install verification pass.
3. Inspect the tarballs, including documentation and licenses. No model weights,
   credentials, private cloud source, or workspace links belong in them.
4. Publish the tested tarballs with explicit `--access public --tag alpha`, in
   dependency order: dsl, runtime, typesafe, laya, providers, then CLI.
5. Verify installation from the registry in another empty directory and check
   `banh --version`, `banh validate`, and a local workflow.
6. Tag the verified commit `v0.1.0-alpha.0` and publish matching release notes.

Publishing is a separate action requiring an explicit release decision. This
preparation does not reserve names, upload packages, push commits, or create tags.
