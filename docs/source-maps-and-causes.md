# Source Maps, Stacks, and Causes

Build configuration: [`tsconfig.build.json`](../tsconfig.build.json). Installed conformance:
[`tooling/testing/packaged-cli.ts`](../tooling/testing/packaged-cli.ts). Structured error contract:
[`public-errors.md`](./public-errors.md).

## Package map policy

Owner decision (#227, D-020): the package ships no source maps. The build
([`tsconfig.build.json`](../tsconfig.build.json)) sets `sourceMap` and `declarationMap` to `false`,
so no `.map` file is emitted, packed, or referenced by a `sourceMappingURL` comment. Until 2.34.0
the package shipped 648 maps that pointed at unshipped `src/*.ts`, so debuggers and
go-to-definition resolved to missing files; dropping them keeps the privacy policy unchanged
(no `sourcesContent`, no TypeScript source, no host path is published) and removes about 4.4 MB
of the 9.8 MB unpacked size. Go-to-definition resolves to the shipped `.d.ts` declarations.

Fresh-tarball verification asserts that the tarball contains no `.map` file and that no shipped
`.js` or `.d.ts` file carries a `sourceMappingURL` comment. An installed unhandled effect under
`--enable-source-maps` verifies that its stack names the emitted
`dist/src/effect/handlers.js` frame. Maps for local debugging can be produced with
`tsc -p tsconfig.build.json --sourceMap --declarationMap --outDir <scratch>`; they are never
packed.

## Cause and propagation matrix

| Boundary | Behavior |
| --- | --- |
| `ErrorOptions` public wrappers | Preserve the exact in-memory `cause` identity through the standard `Error` constructor |
| Run cancellation | `RunCancelledError` preserves the caller signal reason as its in-memory cause |
| Validation normalization | Public validation may wrap a lower validation error as the `cause` of an ordinary unclassified `TypeError` |
| Effect and runner callbacks | Original callback throw/rejection propagates unchanged; no wrapper or fabricated outcome is added |
| Static/custom providers | Static provider errors remain typed; task execution converts provider failure into its documented terminal outcome rather than exposing a stack as durable evidence |
| Trace/task/workspace decoding | Existing wrappers that pass `{ cause }` retain it in memory while returning the same public class/code/message |
| Native execution | Durable receipts carry bounded classified process evidence, not an OS exception stack or nested cause |
| CLI | Closed JSON returns only configured code/remedy data and never serializes message, stack, path, credential, or cause |
| Canonical/durable evidence | Records, archives, receipts, and schemas never acquire diagnostic stack or cause fields |

## Security and compatibility

Stacks and causes are process-local diagnostics. They do not grant retry, recovery, settlement,
filesystem, provider, or execution authority. Existing `instanceof`, error codes, messages,
constructors, terminal outcomes, and redaction remain unchanged.

Validation `TypeError`, caller callbacks, provider implementations, and external failures that are
documented to propagate remain intentionally unclassified or unchanged. Stacks from the installed
package name the emitted JavaScript files.
