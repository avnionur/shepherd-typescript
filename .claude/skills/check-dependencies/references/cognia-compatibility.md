# Cognia Dependency Compatibility Reference

Use this reference with `scripts/check-cognia-dependencies.mjs` when reviewing dependency work.

## Source Manifests

- Root orchestration: `package.json`
- Electron main process: `desktop/package.json`
- React renderer: `desktop/app/package.json`
- Workspace packages: `packages/*/package.json`

Do not use manifests copied into `node_modules/` or `release/` as source of truth.

## Current Compatibility Baseline

- Runtime target: Node 22+ in project guidance, with `@types/node` currently expected on major 22.
- Electron runtime: Electron 43 release metadata reports a Node 24.x embedded runtime; review any Electron major update against current Electron release metadata before deciding whether Node typings should stay on 22 or move with Electron.
- Desktop shell: Electron is managed from `desktop/package.json`.
- Renderer: React 19, React DOM 19, React types 19, Zustand 5.
- Build tooling: TypeScript 5.8+, Vite 6 for renderer, Electron Vite for desktop.
- Pi agents: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` are treated as a pair and should move together.
- MCP: `@modelcontextprotocol/sdk` belongs in `packages/mcp`; Pi core may also pull MCP SDK transitively.
- Monaco VS Code overrides: every `@codingame/monaco-vscode-*` package and `@codingame/monaco-vscode-api` should use the same exact version.

## High-Risk Changes

- Electron major updates: verify embedded Node/Chromium/V8 versions, native module rebuilds, `electron-builder`, `electron-vite`, and `@electron/rebuild` compatibility.
- Native module updates: verify `node-pty`, `sharp`, `@napi-rs/canvas`, and platform-specific optional packages across macOS, Windows, Linux, and arm64 builds.
- Pi agent updates: verify paired package versions, exported APIs used in `desktop/src/agents`, and any model/provider contract changes.
- React major updates: verify `react`, `react-dom`, `@types/react`, `@types/react-dom`, renderer tests, and packages with React peer dependencies.
- Monaco override updates: update the whole `@codingame/monaco-vscode-*` family together.
- Package manager changes: compare root `packageManager`, lockfile metadata, and CI/build expectations.

## Expected Review Output

Summarize:

- changed packages and manifests
- errors from the audit script
- warnings that require source-backed compatibility confirmation
- commands run and whether they passed
- unresolved risks, especially native rebuild or packaging coverage gaps
