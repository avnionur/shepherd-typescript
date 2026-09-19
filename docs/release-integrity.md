# Release integrity

Status: normative from 2.26.0 (Phase 11 slice 2, #179). This page defines the supply-chain
evidence the repository produces, how to verify it locally, and the signing and publication steps
only the owner can perform. Configuration:
[`config/release-integrity.config.json`](../config/release-integrity.config.json). Implementation:
`tooling/release/` (`sbom.ts`, `provenance.ts`, `reproducible-build.ts`, `integrity-config.ts`) with
thin adapters in `scripts/`. Tests: `test/release-integrity.test.ts`.

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

[`.github/workflows/release.yml`](../.github/workflows/release.yml) is present but has never run:
hosted workflows are disabled at the owner's request. On manual dispatch it checks out the commit,
installs with `pnpm install --frozen-lockfile --ignore-scripts`, runs `pnpm verify:release`,
attests the tarball with `actions/attest-build-provenance`, uploads `release/`, and, only when the
`publish` input is set, publishes the attested tarball with `npm publish --provenance` from the
protected `npm-publish` environment. Every action is pinned to a commit SHA resolved read-only from
its release tag.

## Owner-owed steps

These are O-2 in the [production hardening contract](../.plan/production-hardening-contract.md):

1. Decide to publish and remove `"private": true` from `package.json`.
2. Create the protected `npm-publish` environment with required reviewers and an `NPM_TOKEN`
   secret (or npm trusted publishing), and enable hosted workflows.
3. Dispatch `release.yml`, then record the run, the published version, and a verification of the
   Sigstore attestation against the tarball digest (for example `gh attestation verify`).

Until then the repository claims only: a lockfile SBOM, an unsigned provenance statement, and a
host-local reproducible build.
