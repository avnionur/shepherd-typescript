# Release integrity

Status: normative from 2.26.0 (Phase 11 slice 2, #179); packed file-set check and owner release
runbook from 2.33.3 (#191); publication waived for 1.0 by owner decision of 2026-09-23 (#199),
recorded in 2.34.0. 1.0 is a private, unpublished source release: the package stays
`"private": true`, nothing is signed or published, and the runbook below is kept as the procedure
if publication happens later. This page defines the supply-chain evidence the repository produces,
how to verify it locally, and the signing and publication steps only the owner can perform. Configuration:
[`config/release-integrity.config.json`](../config/release-integrity.config.json). Implementation:
`tooling/release/` (`sbom.ts`, `provenance.ts`, `reproducible-build.ts`, `packed-files.ts`,
`integrity-config.ts`) with thin adapters in `scripts/`. Tests: `test/release-integrity.test.ts`.

## Artifacts

| Artifact | Where | Produced by | Checked by |
| --- | --- | --- | --- |
| Software bill of materials | [`docs/generated/sbom.cdx.json`](./generated/sbom.cdx.json) (checked in) and `release/sbom.cdx.json` | `pnpm generate:sbom`, `pnpm release:manifest` | `pnpm check:sbom` in `pnpm verify` |
| Reproducible-build report | `release/reproducible-build.json` | `pnpm release:reproducible-build` | the command itself fails on any difference |
| Packed tarball | `release/<name>-<version>.tgz` | `pnpm release:reproducible-build` (second build) | digest recorded in the report, manifest, and provenance |
| Provenance statement | `release/provenance.intoto.json` | `pnpm release:manifest` | `isProvenanceStatement` type guard |
| Release manifest | `release/release-manifest.json` | `pnpm release:manifest` | lists the SHA-256 of every release file |

`release/` is ignored by Git. Nothing in it is signed.

### SBOM

The SBOM is CycloneDX 1.5-shaped JSON generated from `pnpm-lock.yaml` with the existing `yaml`
dependency; no SBOM tool is added. Each locked package is a component with an npm package URL and
the lockfile integrity digests converted to hexadecimal hashes. Components reachable from the
package's runtime `dependencies` would have scope `required` (or `optional` through optional
edges); the package has zero runtime dependencies, so every component is development or build
tooling with scope `excluded` and the `cdx:npm:package:development` property, and the recorded
runtime component count is 0. Platform-specific optional packages carry
`shepherd:sbom:optional`. The document has no timestamp; its `urn:uuid` serial number is derived
from the SHA-256 of its content, so the same lockfile and manifest always produce the same bytes.

The SBOM covers the lockfile only. It does not describe the Node runtime, the host C toolchain that
builds optional native helpers, or operating-system packages.

### Provenance

The provenance statement is an unsigned [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)
with a [SLSA provenance v1](https://slsa.dev/spec/v1.0/provenance) predicate:

- `subject`: the packed tarball name and SHA-256;
- `buildDefinition.buildType`: `https://github.com/avnionur/shepherd-typescript/blob/main/docs/release-integrity.md#build-type-v1`;
- `buildDefinition.externalParameters`: source commit, working-tree cleanliness, lockfile SHA-256,
  Node and pnpm versions, package name and version;
- `resolvedDependencies`: the Git commit and the lockfile digest;
- `runDetails.builder.id`: `https://github.com/avnionur/shepherd-typescript/blob/main/docs/release-integrity.md#local-unsigned-builder`;
- `runDetails.byproducts`: the SBOM and reproducible-build report digests;
- `runDetails.metadata.invocationId`: derived from the content; no timestamps.

#### Build type v1

`pnpm verify:release` from the recorded commit with a frozen, script-free install of the recorded
lockfile: full verification, two clean `pnpm build` runs each followed by
`npm pack --ignore-scripts`, and a byte comparison of both results.

#### Local unsigned builder

The developer host that ran the command. It holds no signing identity; the statement is evidence of
what was built, not an attestation of who built it.

### Reproducible build

`pnpm release:reproducible-build` runs the configured clean build twice. After each build it
digests every file under the build output (`dist/`) and packs the package into a fresh temporary
directory. It compares the output-tree digests, the tarball SHA-256, and each tarball entry's
content digest, mode, and mtime, and fails listing every differing file (`dist:` or `tarball:`
prefix). On success the second tarball and the report are written to `release/`.

Recorded result on the reference host (macOS arm64 APFS, Node 24.17.0, pnpm 10.32.1) for 2.26.0:
both builds produced `avnionur-shepherd-typescript-2.26.0.tgz` with identical tarball and output-tree
digests (see the tracker entry for the values). No nondeterminism fix was needed: the TypeScript
build and configuration copy are deterministic, and `npm pack` normalizes tarball timestamps.
Reproducibility across operating systems, Node versions, or npm versions is not claimed.

### Packed file set

The `package.json` `files` array is the complete allowlist of what ships, plus what npm always
adds (`packedFiles.alwaysIncluded` in the configuration, `package.json`). npm resolves `files` with
gitignore semantics, and npm versions disagreed on entries without an interior `/`: npm 11
(npm-packlist 10) matched `README.md` in every directory it walked and packed `docs/README.md` and
`spec/README.md`, while npm 12 (npm-packlist 11) matched only the package root (finding F-032).
From 2.33.3 the rules are:

- every entry is a literal path: no glob pattern, negation, `./` prefix, or trailing `/`;
- every top-level entry starts with `/` (`/README.md`, `/examples`), so it matches only at the
  package root for every npm version.

`pnpm test:package-cli` (the last stage of `pnpm verify`, so also `pnpm verify:release` and
`release.yml`) packs the package with the installed npm and fails when a rule is broken, when the
tarball contains a file that no entry declares, or when a declared entry or always-included file
is missing (`assertPackedFileSet`). The rules and the comparison are tested in
`test/release-integrity.test.ts` with the npm 11 file list that exposed F-032.

Recorded on the reference host for 2.33.3: `npm pack --dry-run --json` from npm 11.19.0 and from
npm 12.0.2 list the same 1,406 files, and `npm pack` from both produces byte-identical tarballs.
This makes the file set independent of the npm version; tarball bytes across npm versions are
still not claimed in general.

## Local verification

```sh
pnpm check:sbom          # in pnpm verify: checked-in SBOM matches the lockfile
pnpm generate:sbom       # after a lockfile or version change
pnpm verify:release      # pnpm verify, kernel SLO check, reproducible build, SBOM, provenance, manifest
```

To check a release directory by hand, compare `sha256sum release/*.tgz` with the subject digest in
`release/provenance.intoto.json` and the tarball entry in `release/release-manifest.json`, and
compare `release/sbom.cdx.json` with `docs/generated/sbom.cdx.json` at the recorded commit.

## Release workflow

[`.github/workflows/release.yml`](../.github/workflows/release.yml) is present but has never run.
Hosted workflows are disabled: an attempt on 2026-09-23 (#191) to enable `CI` was blocked by an
account billing limit, and the owner disabled the workflows again. By owner decision of 2026-09-23
([#199](https://github.com/avnionur/shepherd-typescript/issues/199)) signing, publication, and
hosted CI are waived for 1.0, so `release.yml` is not run for 1.0; it also needs hosted runners, so
the billing limit must be resolved before any later run.

From 2.35.0 the workflow runs on a pushed `v<version>` tag or on manual dispatch:

| Job | Runs when | Does |
| --- | --- | --- |
| `build` | Always | Version gate: the tag (if any), `release-config.yaml`, and `package.json` name the same version and `CHANGELOG.md` has its section. Then `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm verify:release`, `actions/attest-build-provenance` over the tarball, and upload of `release/` |
| `github-release` | Tag push, or dispatch with `release=true` (default) | Creates release `v<version>` at the built commit with every file in `release/` as an asset (tarball, `sbom.cdx.json`, `provenance.intoto.json`, `release-manifest.json`, `reproducible-build.json`) and the version's changelog section as notes. A version with a pre-release suffix becomes a pre-release. An existing release is refused, never overwritten. Uses the preinstalled `gh` CLI |
| `publish` | Dispatch with `publish=true` only | From the protected `npm-publish` environment, refuses a `"private": true` tarball, then publishes the attested tarball with `npm publish --provenance`; it never rebuilds |

Every action is pinned to a commit SHA resolved read-only from its release tag. The workflow
passes `actionlint` 1.7.12 with shellcheck.

## Owner release runbook

These steps are O-2 and O-5 in the
[production hardening contract](../.plan/production-hardening-contract.md#owner-owed-register).
By the owner's decision of 2026-09-23
([#199](https://github.com/avnionur/shepherd-typescript/issues/199), D-019) they are waived for 1.0:
1.0 is a private, unpublished source release, the package stays `"private": true`, nothing is
signed or published, and `@avnionur/shepherd-typescript` is not reserved on npm. The runbook stays
as the procedure if publication happens later. Registry and GitHub requirements
change over time; confirm each one against the current npm and GitHub documentation when running
the runbook, and record what was used.

### 1. Preconditions

- Registry name: `@avnionur/shepherd-typescript`, the `name` already in `package.json` (decision
  D-011, confirmed 2026-09-23). `shepherd-ts` is the CLI executable name only; publishing an
  unscoped `shepherd-ts` package is not pursued.
- Hosted Actions can run (the account billing or spending limit that blocked `CI` on 2026-09-23
  is resolved), `main` is green in hosted `CI` for the commit to release, and
  `pnpm verify:release` passes locally on the reference host.
- Repository visibility: npm provenance (`npm publish --provenance`) and GitHub artifact
  attestations are designed for public repositories; a private repository needs a plan that
  supports attestations for private repositories and cannot produce public npm provenance. Make
  the repository public, or record why not, before dispatching with `publish` set.

### 2. npm account and credentials

1. Use an npm account that owns the `@avnionur` scope, with two-factor authentication enabled.
2. Prefer npm trusted publishing (OIDC): on the package's npm settings add a trusted publisher for
   the GitHub repository `avnionur/shepherd-typescript`, workflow `release.yml`, and environment
   `npm-publish`. Trusted publishing needs an npm CLI that supports it in the publish job and the
   `id-token: write` permission, which `release.yml` already grants; the `NODE_AUTH_TOKEN` line
   can then be removed in the same change.
3. Otherwise create a granular access token limited to publishing this package, store it as the
   `NPM_TOKEN` secret of the `npm-publish` environment, and set an expiry. Never commit a token or
   put it in a repository-level secret.
4. A first publish is what reserves the name; `npm login` on a workstation is needed only for
   account and package settings, not for publishing.

### 3. Signing identity

There is no long-lived signing key. The signing identity is the GitHub Actions OIDC identity of
the `release.yml` run: `actions/attest-build-provenance` signs a SLSA provenance attestation for
`release/*.tgz` through Sigstore, and `npm publish --provenance` asks npm to record provenance for
the same tarball. Create the protected `npm-publish` environment with required reviewers and
restrict it to `main` so only a reviewed dispatch from `main` can publish.

### 4. Drop `"private": true`

In a reviewed pull request, remove `"private": true` from `package.json`, add the CHANGELOG entry
and version bump required by `AGENTS.md`, run `pnpm sync:version`, `pnpm verify`, and
`pnpm build:desktop`, and merge only after hosted `CI` passes.

### 5. Run `release.yml`

1. Dispatch without publishing first: `gh workflow run release.yml --ref main -f publish=false`
   (add `-f release=false` to skip the GitHub Release). The build job runs `pnpm verify:release`
   (which includes the packed file-set check), attests the tarball, and uploads `release/`.
   Alternatively push the version tag (`git tag v<version> && git push origin v<version>`), which
   builds and creates the GitHub Release but never publishes to npm.
2. Download the evidence: `gh run download <run-id> --name release --dir release-<version>`.
3. When the evidence verifies (step 6), dispatch again with `-f publish=true` and approve the
   `npm-publish` environment. The publish job publishes the attested tarball from the build job;
   it does not rebuild.

### 6. Verify the attestation against the tarball digest

```sh
shasum -a 256 release-<version>/*.tgz            # must equal the provenance subject and manifest entry
gh attestation verify release-<version>/<tarball>.tgz --repo avnionur/shepherd-typescript
npm pack @avnionur/shepherd-typescript@<version> # after publish: the registry tarball
shasum -a 256 avnionur-shepherd-typescript-<version>.tgz  # must equal the attested digest
npm audit signatures                             # in a consumer project that installed the package
```

The SHA-256 of the tarball must be identical in `release/provenance.intoto.json` (`subject`),
`release/release-manifest.json`, the verified GitHub attestation, and the registry tarball.

### 7. Record the evidence

Add the run URL, the published version, the tarball SHA-256, and the output of the verification
commands to a Phase 11 exit audit addendum and the
[release-candidate manifest](../.plan/release-candidate-manifest.md), mark F-010 fixed in the
[security review](../.plan/security-review.md), and update the tracker. Until then the repository
claims only: a lockfile SBOM, an unsigned provenance statement, a host-local reproducible build,
and a packed file set that does not depend on the npm version.
