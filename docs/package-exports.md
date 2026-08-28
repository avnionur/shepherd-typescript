# Package exports and module policy

The package is ESM-only on Node 24 or newer. Supported imports are:

```ts
import { task } from "@avnionur/shepherd-typescript";
import { canonicalizeRecord } from "@avnionur/shepherd-typescript/canonical";
import { runCli, type CliIo } from "@avnionur/shepherd-typescript/cli";
import { createStaticProvider } from "@avnionur/shepherd-typescript/providers";
import { executeTask, executeTaskDurably } from "@avnionur/shepherd-typescript/runs";
import { schema, SQLiteTaskRegistry, task } from "@avnionur/shepherd-typescript/tasks";
import { listTraceRevisions, SQLiteTraceStore } from "@avnionur/shepherd-typescript/trace";
```

The root preserves the complete existing public API. `./canonical` is the cohesive canonical
encoding/identity surface. `./cli` contains the reusable runner and injectable I/O boundary.
`./tasks` owns task/schema construction, task registry contracts/errors, and bounded task-ledger
reads; it intentionally excludes providers, run execution/control, trace stores, workspace grants,
and private migrations. `./providers` owns the provider-neutral contract, descriptors,
artifact/usage response types, deterministic static adapter, and stable errors; execution, tools,
credentials, and workspace authority remain excluded. Undeclared deep imports are rejected.

`./trace` is Node-only and explicitly write-capable through `SQLiteTraceStore`. It owns public
append/cut/slice/blob contracts, integrity and native archive methods, store errors/types, and
bounded run/output/trace/recovery evidence reads. It excludes task registry, providers, executors,
workspace carriers/settlements, private SQL/migrations, and protocol configuration. A future
web-safe type-only/read split must not be inferred from this Node entry.

`./runs` is Node-only and owns public run builders/types/errors, budgets and cancellation,
provider-neutral task execution, and durable execution/control/recovery/inspection. Consumers
must supply authenticated task descriptors from `./tasks`, provider authority from `./providers`
or another contract implementation, and an open trace authority from `./trace` for durable calls.
The facade creates no ambient provider, persistence, or workspace authority. It excludes task
registries, provider adapters, the SQLite store constructor, workspace carrier/settlement handles,
private codecs, migrations, and protocol configuration.

CommonJS `require()` is intentionally unsupported; use ESM or dynamic `import()`. The package does
not ship a partial CommonJS transform. TypeScript consumers use `moduleResolution: "NodeNext"`,
the `ESNext` disposable library, and Node declarations.

Fresh-tarball conformance imports every entry at runtime, typechecks every declaration entry,
rejects CommonJS and deep imports, verifies declaration/source maps, composes the task, provider,
run, and trace facades for offline and durable execution, and reruns the offline quickstart through
the root facade.
