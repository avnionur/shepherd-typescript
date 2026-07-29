---
name: check-dependencies
description: Audit Cognia dependency versions and compatibility across package.json files. Use when changing, reviewing, or troubleshooting dependencies, especially Electron, desktop packaging, React renderer, Pi agent packages, MCP SDK, Monaco VS Code overrides, native modules, package manager versions, or workspace package compatibility.
---

# Check Dependencies

Use this skill to examine dependency changes before they land. Prefer deterministic manifest checks first, then investigate upstream compatibility notes only for packages that changed or were flagged.

## Workflow

1. Read the relevant manifests:
   - `package.json`
   - `desktop/package.json`
   - `desktop/app/package.json`
   - `packages/*/package.json`
   - `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `release-config.yaml` when version drift or packaging is in scope.
2. Run the bundled audit script from the repo root:

   ```bash
   node .claude/skills/check-dependencies/scripts/check-cognia-dependencies.mjs
   ```

3. Read `references/cognia-compatibility.md` when a report item needs interpretation or when reviewing a manifest diff.
4. For changed third-party versions, verify compatibility from primary sources before declaring a dependency safe:
   - official package docs, release notes, changelogs, or package manifests
   - Electron release/runtime docs for Node, Chromium, V8, and native module impact
   - `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` package metadata for peer or paired-version expectations
5. Report findings by severity:
   - **Error** — likely breakage or an invariant violation that should be fixed before merge.
   - **Warning** — compatibility risk requiring review or targeted testing.
   - **Info** — useful version inventory.

## What To Check

- Keep `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` aligned to the same version/range.
- Keep `electron`, `electron-builder`, `electron-vite`, `@electron/rebuild`, Node typings, TypeScript, Vite, and native modules compatible with the desktop runtime.
- Keep React, React DOM, React types, Zustand peers, and renderer package expectations aligned.
- Keep every `@codingame/monaco-vscode-*` override and `@codingame/monaco-vscode-api` pinned to the same exact version.
- Keep internal `@cognia/*` dependencies as `workspace:*` unless there is a deliberate packaging reason.
- Treat native dependencies (`node-pty`, `sharp`, `@napi-rs/canvas`, Electron rebuild tooling) as packaging risks whenever Electron or Node ABI changes.
- Ignore generated dependency copies under `node_modules/` and `release/`; source manifests are the root of truth.

## Validation

After any dependency edit, run at least:

```bash
node .claude/skills/check-dependencies/scripts/check-cognia-dependencies.mjs
pnpm install --lockfile-only
pnpm build:desktop
```

If TypeScript source changed as part of the dependency work, also run `npx tsc --noEmit` and relevant tests.

After validation, if everything is ok, use `/bump-version` to write the changelog entry, bump `release-config.yaml`, sync package versions, and run the required desktop build.
