# Contributing

Contributions should implement observable protocol behavior in small, reviewable slices.

## Setup

Requirements:

- Node.js 24 or newer;
- pnpm 10.32.1.

Install and verify:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm build:desktop
```

## Development rules

- Test behavior through the public entry point in `src/index.ts`.
- Preserve existing capabilities and assertions on every changed path.
- Keep modules cohesive and avoid hard-coded static configuration.
- Use strict, erasable TypeScript without `any` or inline imports.
- Document every public TypeScript API with JSDoc.
- Keep implemented contracts in `docs/` and unfinished work in `.plan/`.
- Update README, documentation index, tracker, changelog, and version when required by `AGENTS.md`.
- Review dependency and lockfile changes as source code.

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

## Security reports

Follow [SECURITY.md](./SECURITY.md). Never disclose an unpatched vulnerability in a public issue or
pull request.
