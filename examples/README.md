# TypeScript examples

- `retained-coding.ts` plus `retained-coding.json`: offline capture, inspection, and exact selection
  of a source-file edit. Requires a new destination directory.
- `quickstart.mjs`: the unchanged original offline retained-output quickstart.
- `custom-effects.ts` plus `custom-effects.json`: typed intents/outcomes, exact-kind precedence,
  correlation checks, explicit failure data, and unhandled-effect errors.
- `multiple-bindings.ts` plus `multiple-bindings.json`: independent sequential captures and exact
  settlements for disjoint bindings, with sibling-file preservation.
- `read-only-review.ts` plus `read-only-review.json`: repeatable bounded inspection of an existing
  retained-coding workspace, without new capture or settlement.

See the packaged [TypeScript example guide](../docs/typescript-examples.md) for execution,
expected results, authority limits, and installed-package verification.

`manifest.json` lists the TypeScript scenarios and independent conformance expectations.
It also links the [migration guide](../docs/python-to-typescript.md), whose TypeScript excerpts
are checked against the installed example source before full-example typechecking and execution.
