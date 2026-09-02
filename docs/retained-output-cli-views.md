# Retained-output CLI views

Implementations: [`src/cli/handlers.ts`](../src/cli/handlers.ts),
[`src/ledger/output-citations.ts`](../src/ledger/output-citations.ts), and
[`src/workspace/changeset-inspection.ts`](../src/workspace/changeset-inspection.ts). Tests:
[`test/cli/cli.test.ts`](../test/cli/cli.test.ts) and
[`tooling/testing/packaged-cli.ts`](../tooling/testing/packaged-cli.ts).

## Outputs

`shepherd-ts run outputs` lists bounded cut-published retained products. Each row carries the exact
output, run, and current retained/terminal settlement state. Supplying an exact output ID, unique
prefix, or `@latest` shows its run, changeset, and state. JSON returns the complete existing
`OutputCitationEntry`; the CLI creates no parallel evidence shape.

## Changeset

`shepherd-ts run changeset OUTPUT_SELECTOR --workspace ROOT --store PATH` authenticates the
output citation and its base/head revisions through the workspace reference carrier. It prints a
bounded canonical page selected by `--limit` and `--offset`. JSON returns exact output/run/binding
IDs, the authenticated changeset, inspection version, and page.

Add `--read RELATIVE_PATH` to read a changed after-state regular file from retained custody.
`--max-bytes` selects a positive configured UTF-8 preview bound and is valid only with `--read`.
The command never consults the user file at that path. Missing/deleted/non-file paths, binary
content, corrupt revisions/blobs, unsafe relative paths, unavailable custody, and excessive bounds
fail closed.

## Vcs-core citations

`shepherd-ts run vcscore OUTPUT_SELECTOR --store PATH` presents the native cut-bounded citation:
output, run, binding, changeset, capture record, execution cut, and settlement count. JSON returns
the complete citation. This is the native counterpart to the upstream public vcs-core view; it
does not invent private upstream fields.

All three commands open SQLite with the current-schema read-only policy. They do not migrate,
repair, recover, settle, invoke a provider, mutate Git, or write user files. Output/vcs-core views
reconstruct after native archive import. Changeset content additionally requires the original
authenticated carrier bytes and fails visibly when those bytes are unavailable.
