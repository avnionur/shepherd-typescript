# Web-safe trace read types

Public entry: [`src/facades/read.ts`](../src/facades/read.ts), exported as
`@avnionur/shepherd-typescript/read`. Verification:
[`installed loading and typecheck`](../tooling/testing/entry-loading.ts),
[`consumer fixture`](../test/fixtures/read-surface.ts.txt), and
[`type identity test`](../test/facades/read.test.ts).

```ts
import type { Slice } from "@avnionur/shepherd-typescript/read";

function renderTrace(slice: Slice, element: HTMLElement): void {
    element.textContent = Object.keys(slice.visible_records_by_id).join(", ");
}
```

This entry re-exports existing readonly semantic values, record bodies/envelopes/identifiers,
owner ordinals/views/occurrences, retained records, cuts, slices, mode/visibility/closure values
as types, and external/witness anchors. The [generated reference](./generated/api-reference.md)
lists the exact exports. Their identities and field contracts are unchanged; the Node
[`trace` entry](./package-exports.md) still owns actual reads and storage authority.

Use `import type`. There are no runtime values: the emitted ESM entry is empty, imports no
dependencies, reads no configuration, and requires no Node runtime. Installed declarations are
checked with `types: []`, `lib: ["ESNext", "DOM"]`, strict checking, and `skipLibCheck: false`
under both Bundler and NodeNext resolution. No Node declarations or polyfills are required for
this entry. This is not a browser implementation of the other package entries. The package's
Node engine requirement still describes its executable/runtime APIs and build tools.

Readonly is a compile-time property, not runtime freezing, validation, authorization, or a
security boundary. Data parsed from JSON still needs validation at the application's trusted
boundary; assigning a TypeScript type does not authenticate trace evidence. There is no new wire
format, HTTP client, redaction layer, or serialization guarantee. The producer must choose the
appropriate [slice visibility](./trace-queries.md) and control disclosure before data reaches a UI.

Store handles, append requests, settlement commands, runtime constants, projection functions,
and query methods are deliberately absent. The Node store's
[`iterateCutRecords`](./trace-queries.md#async-owner-record-iteration) yields the same `OwnerRecord`
type but is not exported here. Broader read projections remain separately scoped work.
Verification covers installed declaration compilation and dependency-free
Node ESM import, not execution in a browser engine or universal browser bundler support.
