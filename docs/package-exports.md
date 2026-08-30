# Package exports and module policy

The package is ESM-only on Node 24 or newer. Supported imports are:

```ts
import { task } from "@avnionur/shepherd-typescript";
import { canonicalizeRecord } from "@avnionur/shepherd-typescript/canonical";
import { runCli, type CliIo } from "@avnionur/shepherd-typescript/cli";
import { createEffectHandlerStack, createEffectIntent } from "@avnionur/shepherd-typescript/effects";
import { createStaticProvider } from "@avnionur/shepherd-typescript/providers";
import { executeTask, executeTaskDurably } from "@avnionur/shepherd-typescript/runs";
import { schema, SQLiteTaskRegistry, task } from "@avnionur/shepherd-typescript/tasks";
import { listTraceRevisions, SQLiteTraceStore } from "@avnionur/shepherd-typescript/trace";
import {
    createWorkspaceBindings,
    initializeWorkspace,
} from "@avnionur/shepherd-typescript/workspace";
```

The root preserves the complete existing public API. `./canonical` is the cohesive canonical
encoding/identity surface. `./cli` contains the reusable runner and injectable I/O boundary.
The root also exports `PublicError`, `PublicErrorCode`, and `isPublicError` for additive in-memory
classification without adding error metadata to canonical records or CLI JSON.
`./tasks` owns task/schema construction, task registry contracts/errors, and bounded task-ledger
reads; it intentionally excludes providers, run execution/control, trace stores, workspace grants,
and private migrations. `./providers` owns the provider-neutral contract, descriptors,
artifact/usage response types, deterministic static adapter, and stable errors; execution, tools,
credentials, and workspace authority remain excluded. Undeclared deep imports are rejected.

`./effects` owns immutable effect intent/outcome builders, exact correlation validation, ordered
exact-kind handler stacks, their public types, and stable unhandled-effect errors. Handlers are
caller-supplied in-process callbacks and dispatch is non-durable. The facade does not append trace
records, materialize world changes, intercept execution, provide replay, or create a sandbox. It
excludes formal proof/reference machinery, task/provider/run execution, trace persistence,
workspace settlement, private validators, migrations, and protocol configuration.

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

`./workspace` is Node-only and owns workspace initialization/bindings, copy and Git custody,
changeset inspection, repository grants, placement/native-jail evidence, retained-world runners
and execution journals, and exact prepare/select/apply/release/discard settlement operations. These
APIs can read or mutate caller-selected filesystem/Git state, and native runners can launch a
capability-probed process. Consumers must explicitly supply the required task, provider, run,
trace-store, carrier, runner, and grant handles from their owning domains. The facade excludes task
registries, provider adapters, run builders/controls, the SQLite store constructor, low-level trace
mutation, private codecs, migrations, and protocol configuration; it creates no ambient authority.

CommonJS `require()` is intentionally unsupported; use ESM or dynamic `import()`. The package does
not ship a partial CommonJS transform. TypeScript consumers use `moduleResolution: "NodeNext"`,
the `ESNext` disposable library, and Node declarations.

Fresh-tarball conformance imports every entry at runtime, typechecks every declaration entry,
rejects CommonJS and deep imports, verifies declaration/source maps, validates effect records and
handler precedence, and composes the task, provider, run, trace, and workspace facades through an
installed offline retained-output consumer, read-only changeset inspection, and exact settlement.
It separately reruns the unchanged root-facade quickstart.

Every supported entry includes JavaScript and declaration maps. Their portable source-path,
embedded-content, installed-stack, and redaction policy is defined in
[`source-maps-and-causes.md`](./source-maps-and-causes.md).
