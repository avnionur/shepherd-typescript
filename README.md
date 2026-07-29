# Shepherd TypeScript

An independent TypeScript implementation of Shepherd's reversible agent execution model.

The project is being built from a language-neutral protocol so TypeScript and Python can produce
and verify the same execution records. It is an early implementation and is not affiliated with
the upstream Shepherd authors.

Publication is intentionally disabled while Phase 0 package naming and licensing are unresolved.
Current examples import the source entry point for repository development only.

## Current capability

Version `0.1.0` provides the first trace-kernel primitive:

- deterministic recursive object-key ordering;
- stable array ordering;
- omission of undefined object properties;
- rejection of unsupported or cyclic values;
- configured SHA-256 content identifiers;
- Node-native TypeScript execution and tests.

The implementation preserves Unicode code points as supplied. It does not normalize Unicode.

## Requirements

- Node.js 24 or newer
- pnpm 10

## Install

```sh
pnpm install
```

## API

```ts
import { canonicalizeRecord, createRecordId } from "./src/index.ts";

const record = { operation: "task.started", ordinal: 1 };

canonicalizeRecord(record);
// {"operation":"task.started","ordinal":1}

createRecordId(record);
// sha256:<digest>
```

Only JSON-compatible semantic values are accepted. Undefined object properties are omitted;
undefined array elements, non-finite numbers, accessors, symbol properties, class instances, and
cycles are rejected.

## Development

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify
```

Biome provides formatting and linting. Node's built-in test runner executes TypeScript directly.
The test command enforces 100% line, branch, and function coverage for runtime source. TypeScript
builds declarations and JavaScript into `dist/`.

Release versions are configured in `release-config.yaml`. After changing the version, run
`pnpm sync:version` to update every configured JSON manifest.

## Documentation

- [Implementation plan](./.plan/README.md)
- [Progress tracker](./.plan/tracker.md)
- [Canonical record contract](./docs/canonical-records.md)
- [Changelog](./CHANGELOG.md)

## Status

Phase 0 repository foundation is in progress, with the first Phase 1 canonical-record primitive
implemented. The next slice completes the remaining Phase 0 baseline decisions and CI foundation.

## Attribution

The design is informed by the MIT-licensed
[Shepherd project](https://github.com/shepherd-agents/shepherd) and its
[research paper](https://arxiv.org/abs/2605.10913). Compatibility claims are tracked explicitly;
paper-level behavior is not yet implemented.
