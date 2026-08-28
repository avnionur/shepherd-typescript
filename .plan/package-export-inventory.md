# Package export inventory

Status: Phase 5 Task 6 implemented inventory

| Entry | Owner | Runtime | Stability | Notes |
| --- | --- | --- | --- | --- |
| `.` | `src/index.ts` | Node 24 ESM | Existing public root | Preserves every Phase 4 export; includes SQLite, filesystem, Git, and native surfaces |
| `./canonical` | `src/facades/canonical.ts` | ESM, web-safe logic | Stable additive subpath | Canonical encoding, identity, and semantic value types only |
| `./cli` | `src/facades/cli.ts` | Node 24 ESM | Stable additive subpath | Reusable runner and injectable I/O type; no process exit |
| `./providers` | `src/facades/providers.ts` | ESM | Stable additive subpath | Provider contract/types, deterministic static adapter, and stable public errors |
| `./runs` | `src/facades/runs.ts` | Node 24 ESM | Stable additive subpath | Run builders/types/errors, budgets/cancellation, provider-neutral execution, and durable execution/control/recovery/inspection |
| `./tasks` | `src/facades/tasks.ts` | Node 24 ESM | Stable additive subpath | Task/schema builders, registry contract/errors, and bounded task-ledger reads |
| `./trace` | `src/facades/trace.ts` | Node 24 ESM | Stable additive subpath | Write-capable trace store, cuts/slices/blobs, integrity/archive, and bounded trace/run evidence reads |
| `./workspace` | `src/facades/workspace.ts` | Node 24 ESM | Stable additive subpath | Workspace initialization/bindings, custody/inspection, grants/placement, retained execution, and exact settlement authority |

`./runs` owns run construction and execution authority. Offline execution requires an exact task
descriptor and provider supplied by the consumer; durable APIs additionally require an open
`SQLiteTraceStore` supplied from `./trace`. The facade does not construct those authorities and
does not export task registries, provider adapters, the SQLite store constructor, workspace
carrier/settlement handles, private codecs, migrations, or protocol configuration. Its SQLite
type dependency makes the entry Node-only; no web-safe or ambient-execution claim is made.

`./workspace` owns workspace authority construction and retained-world operations. Its APIs may
read or mutate caller-selected filesystem/Git state, launch capability-probed native processes,
and consume exact settlement authority. Durable calls require an open `SQLiteTraceStore`, exact
task/run/provider authority, and authenticated carrier/runner/grant handles supplied by the
consumer. The facade does not export task registries, provider adapters, run builders/controls,
the SQLite store constructor, low-level trace mutation, private codecs, migrations, or protocol
configuration. It is Node-only and makes no web-safe, ambient-filesystem, or ambient-execution
claim.

Further web-safe/type-only splits remain deferred until their ownership and dependency boundaries
can be declared cohesively. Direct `dist/src/...` imports are not public.

The package is ESM-only. No `require` condition or CommonJS artifact is shipped; CommonJS consumers
must use dynamic `import()`. This avoids a partial interop claim across `using`, Node SQLite, ESM
URLs, and package-owned native helpers.
