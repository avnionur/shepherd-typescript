# Contributing

Contributions should implement observable protocol behavior in small, reviewable slices.

## Setup

Requirements:

- Node.js >=24.12.0 <27;
- pnpm 10.32.1.

Install and verify:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm build:desktop
```

## Development rules

- Test behavior through the public entry point in `src/index.ts`.
- Keep unit tests and test assets under `test/`.
- Preserve existing capabilities and assertions on every changed path.
- Keep modules cohesive and avoid hard-coded static configuration.
- Regenerate protocol artifacts with `pnpm generate:protocol` after changing
  `protocol.config.json`.
- Regenerate the API reference with `pnpm generate:api-reference` after changing package exports or
  public declarations; `pnpm check:api-reference` rejects stale output.
- Use strict, erasable TypeScript without `any` or inline imports.
- Document every public TypeScript API with JSDoc.
- Keep implemented contracts in `docs/` and unfinished work in `.plan/`.
- Update README, documentation index, tracker, changelog, and version when required by `AGENTS.md`.
- Review dependency and lockfile changes as source code.

## Compatibility and release evidence per pull request

After the version bump and `pnpm sync:version`, every pull request refreshes the generated
evidence that records the version:

1. `pnpm generate:api-reference`;
2. `pnpm generate:sbom` (the SBOM records the package version and the lockfile);
3. `pnpm update:compatibility-baseline`, adding `--classify additive` or `--classify breaking`
   (with `--note`) only after judging every changed declaration or value it reports.

`pnpm verify` fails while any of them is stale. Removals need a deprecation that shipped for the
configured window and a MAJOR bump; see the [compatibility policy](./docs/compatibility-policy.md).
Review `spec/compatibility/` diffs as compatibility decisions: never hand-edit baselines or
recorded change-log entries. Before a release, `pnpm verify:release` reproduces the build and
writes the SBOM and unsigned provenance ([release integrity](./docs/release-integrity.md)).

## Pull requests

Describe:

1. the observable behavior changed;
2. the tests or fixtures proving it;
3. preserved adjacent capabilities;
4. security, compatibility, and migration effects;
5. documentation and version updates.

Run `pnpm verify` and `pnpm build:desktop` before requesting review. Keep unrelated changes out of
the pull request.

## Commits

Use:

```text
{feat,fix,docs}[(scope)]: concise description
```

Do not bypass hooks or force-push shared branches without explicit coordination.

## Security-sensitive changes

A change that touches a trust boundary in the [threat model](./docs/threat-model.md) (caller API
validation, CLI parsing, archive import, store files, provider responses, task revision, native
helpers, supervision, or Git execution) must update the threat model row it affects, cite the test
that proves the mitigation, and add or close a finding in the
[findings register](./.plan/security-review.md#findings-register). Do not add dependencies for
hardening work (decision D-017).

## Security reports

Follow [SECURITY.md](./SECURITY.md). Never disclose an unpatched vulnerability in a public issue or
pull request. Maintainers handle reports under [incident response](./docs/incident-response.md);
the [support policy](./docs/support-policy.md) states what is supported.
