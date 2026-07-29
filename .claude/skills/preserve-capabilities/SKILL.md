---
name: preserve-capabilities
description: Prevent capability loss while adding features, fixing bugs, refactoring, upgrading dependencies, or changing desktop, renderer, IPC, pack, configuration, persistence, or workflow behavior. Use before implementation begins, during verification, and during review whenever a change could affect existing behavior.
---

# Preserve Capabilities

Treat every existing user-visible behavior as a contract. Establish preservation
evidence before editing, then prove both the requested change and adjacent behavior
at the public seams they use.

## 1. Inventory before editing

Read the relevant source files in full, their existing tests, architecture
documentation, and recent `CHANGELOG.md` entries. Identify:

- the requested new or corrected behavior;
- existing behavior on the same execution path;
- adjacent callers, stores, IPC channels, persisted state, pack/config inputs,
  and platform behavior;
- capabilities that the change intentionally alters, with user approval.

Before editing, write a compact preservation matrix:

| Capability | Existing evidence | Change risk | Required verification |
| --- | --- | --- | --- |
| Requested behavior | Spec or reproduction | High | Acceptance/regression test |
| Existing behavior on changed path | Test or characterization | High | Same public seam |
| Adjacent behavior | Existing test | Medium | Focused or integration suite |
| Platform/package behavior | Smoke scenario | Risk-based | Desktop smoke/build |

Do not rely on a changelog statement alone as evidence.

## 2. Choose the preservation seams

Test behavior through the same public interface used in production:

- pure logic through its exported interface;
- renderer behavior through rendered interactions and stores;
- main/renderer behavior through the IPC or host-bridge contract;
- persistence through save, restart/restore, and migration boundaries;
- pack behavior through generic schema and contract fixtures;
- Electron behavior through an app-level smoke scenario.

When coverage is missing, add a characterization test and run it against the
unchanged code before implementation. For a bug, first reproduce the exact symptom
with a red-capable regression test.

If no correct automated seam exists, record that architectural gap and define a
repeatable manual check. Do not add a shallow test that cannot detect the real
failure.

## 3. Implement in vertical slices

For each slice:

1. Add or identify the behavior test.
2. Run it before the production change.
3. Make the smallest coherent implementation.
4. Run the focused test and the preservation tests.
5. Update the matrix when newly discovered coupling changes the risk.

Never delete, weaken, skip, or rewrite an existing assertion merely to make the
change pass. A changed contract requires explicit user approval and a test
expressing the replacement behavior.

## 4. Verify by risk

Always run:

- focused tests for changed and adjacent behavior;
- the repository typecheck;
- the complete repository test command;
- the production desktop build.

Also run repeatable desktop smoke checks when behavior crosses Electron, preload,
IPC, native dialogs, windows, filesystem integration, packaged resources, startup,
updates, or persistence. Verify each affected supported platform when
platform-specific code changes.

Distinguish a failed check from an unrelated pre-existing failure with baseline
evidence. Never describe a skipped, unavailable, or failing check as passing.

## 5. Review the capability delta

Before completion, compare the final diff with the preservation matrix:

- every high-risk row has evidence from the correct seam;
- the requested behavior is proven;
- existing assertions were not weakened;
- removed behavior has explicit approval;
- generic/config-driven behavior remains generic;
- failures and unverified platform scenarios are reported.

Include the completed matrix or an equivalent concise list in the handoff. Do not
declare completion while a high-risk row lacks automated evidence or a documented
repeatable manual verification.
