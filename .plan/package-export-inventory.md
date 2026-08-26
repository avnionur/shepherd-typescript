# Package export inventory

Status: Phase 5 Task 1 implemented inventory

| Entry | Owner | Runtime | Stability | Notes |
| --- | --- | --- | --- | --- |
| `.` | `src/index.ts` | Node 24 ESM | Existing public root | Preserves every Phase 4 export; includes SQLite, filesystem, Git, and native surfaces |
| `./canonical` | `src/facades/canonical.ts` | ESM, web-safe logic | Stable additive subpath | Canonical encoding, identity, and semantic value types only |
| `./cli` | `src/facades/cli.ts` | Node 24 ESM | Stable additive subpath | Reusable runner and injectable I/O type; no process exit |

Task, run, trace, store, and workspace subpaths are deferred until their ownership and native/web
dependency boundaries can be declared cohesively. Direct `dist/src/...` imports are not public.

The package is ESM-only. No `require` condition or CommonJS artifact is shipped; CommonJS consumers
must use dynamic `import()`. This avoids a partial interop claim across `using`, Node SQLite, ESM
URLs, and package-owned native helpers.
