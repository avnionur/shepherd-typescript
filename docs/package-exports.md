# Package exports and module policy

The package is ESM-only on Node 24 or newer. Supported imports are:

```ts
import { task } from "@avnionur/shepherd-typescript";
import { canonicalizeRecord } from "@avnionur/shepherd-typescript/canonical";
import { runCli, type CliIo } from "@avnionur/shepherd-typescript/cli";
```

The root preserves the complete existing public API. `./canonical` is the cohesive canonical
encoding/identity surface. `./cli` contains the reusable runner and injectable I/O boundary.
Undeclared deep imports are unsupported and rejected by the package export map.

CommonJS `require()` is intentionally unsupported; use ESM or dynamic `import()`. The package does
not ship a partial CommonJS transform. TypeScript consumers use `moduleResolution: "NodeNext"`,
the `ESNext` disposable library, and Node declarations.

Fresh-tarball conformance imports every entry at runtime, typechecks every declaration entry,
rejects CommonJS and deep imports, verifies declaration/source maps, and reruns the offline
quickstart through the root facade.
