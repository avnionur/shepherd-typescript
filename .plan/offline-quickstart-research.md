# Packaged offline quickstart research

Status: Phase 4 Task 12 implemented oracle record

## Pinned oracle

- Repository: `https://github.com/shepherd-agents/shepherd`
- Tag: `v0.3.0`
- Revision: `a8196d4c453514836d06bd2fece91a03cdc37107`
- Installed-wheel test: `docs/_src/shepherd/quickstart/test_world_hero.py`
- Hero source: `docs/_src/shepherd/quickstart/world_hero.py`
- Package integration: `integration-tests/test_quickstart_core.py`
- Checked examples: `examples/quickstart/`

The pinned wheel test creates a fresh directory, runs the installed CLI initializer, executes the
published hero in a separate process with repository shims excluded, and requires the installed
package import to succeed. It asserts the changed-path transcript `['NOTE.txt']` and retained text
`Hello from a Shepherd retained output.`. The hero uses a deterministic static provider, inspects
the proposal before settlement, and selects it exactly once.

## TypeScript mapping

The checked-in `examples/quickstart.mjs` is both the documentation source and the exact bytes
emitted by `shepherd-ts demo write quickstart`. It imports the installed package root, initializes
the current fresh directory without Git adoption, declares a bodyless task, and uses the existing
static-provider and retained-world public seams. The runner creates `NOTE.txt` only inside isolated
custody. The script refuses if the user file exists before settlement, reads the retained bytes,
prints the pinned transcript, then prepares and selects the exact output.

The TypeScript package deliberately does not execute source text supplied by the caller. Its demo
uses a checked-in module and the existing `task(...)` descriptor rather than reproducing upstream
`register_source(...)`. The package declares only the established ESM root `dist/src/index.js` and
its declarations; subpath exports, CommonJS policy, facade redesign, and tree-shaking remain Phase
5.

## Security and compatibility boundary

- The quickstart is offline, deterministic, keyless, and contains no live-provider path.
- Advisory authority remains an authenticated in-process capability, not an OS jail claim.
- `writeText` may now create one missing regular file directly beneath the binding root.
  Traversal, nested creation, control/Git metadata, symbolic links, non-directory parents, and
  size/fence violations remain refused; directory creation and deletion remain unavailable.
- The trace store lives under the protected workspace control directory and is not part of the
  user binding or changed-path transcript.
- Repeat walkthroughs use fresh workspaces. Exact consume-once settlement and moved-basis refusal
  remain authoritative.
