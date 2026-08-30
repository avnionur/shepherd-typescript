# Source Maps, Stacks, and Causes

Build configuration: [`tsconfig.build.json`](../tsconfig.build.json). Installed conformance:
[`scripts/test-packaged-cli.ts`](../scripts/test-packaged-cli.ts). Structured error contract:
[`public-errors.md`](./public-errors.md).

## Package map policy

Every supported package entry ships both a JavaScript source map and a declaration map. Each map:

- is source-map version 3 and names its adjacent emitted file;
- uses an empty `sourceRoot` and portable forward-slash relative source paths;
- resolves within the installed package root and contains no repository-host or temporary absolute
  path;
- omits `sourcesContent`, so the tarball does not duplicate or silently publish unlisted source;
- remains usable by Node's `--enable-source-maps` support even though the mapped TypeScript source
  is not shipped as an importable deep path.

Fresh-tarball verification applies these checks independently to repository-built and installed
root/domain entry artifacts. An installed unhandled effect verifies that its stack points to
`src/effect/handlers.ts` rather than the emitted `dist/src/effect/handlers.js` frame.

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
documented to propagate remain intentionally unclassified or unchanged. Source-map support changes
stack presentation only when the consuming Node process opts into it.
