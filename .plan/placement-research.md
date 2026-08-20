# Placement Resolution Research

Status: Phase 4 Task 3 implemented oracle record

Research date: 2026-08-19

Pinned shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

## Reviewed primary evidence

- [pinned placements concept](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/concepts/placements.md)
- [pinned ambient world-access refusal tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/runtime/tests/unit/nucleus/test_placement_refusal.py)
- [pinned dialect placement-refusal verification](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_placement_refusal_dialect_lane.py)
- [pinned confinement lowering](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/src/shepherd_dialect/confinement.py)
- [pinned per-binding confinement tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_per_binding_confinement.py)

## Verified carried-forward behavior

The pinned `v0.3.0` tree carries the release-ready placement contract first documented for v0.2:

- placement is a per-run choice;
- `jail` requires native syscall enforcement and fails closed when unavailable;
- `advisory` is in-process, recorded honestly, and does not claim OS enforcement;
- `auto` prefers a real jail backend but visibly resolves to advisory when none is available;
- the run record makes the resolved placement/enforcement legible after execution.

The pinned refusal tests additionally establish the fail-before-provider principle for world-aware
bodyless execution outside the sanctioned workspace lane. The confinement sources prove grant
lowering and native-jail preconditions, but they do not define a language-neutral placement
artifact, platform evidence hash, or TypeScript API.

## TypeScript-owned contract

Workspace protocol v22 adds content-addressed platform evidence and placement resolution. Exact
field spelling, identity domains, JSON Schemas, platform-family/environment vocabulary, WSL marker
classification, and journal-v11/v3 evidence are TypeScript-owned because no pinned fixture defines
them.

The platform classifier is explicit and injectable. Local inspection uses Node platform, OS
release, and environment-variable names only, and local placed execution rejects synthetic probe
handles. WSL is reported as Windows-family/WSL-environment while its Node platform remains Linux.
Native Windows is reported separately. Unsupported Node platforms remain explicit instead of being
guessed into a supported family.

The current resolution table has no jail backend. Both `advisory` and `auto` resolve to actual
advisory enforcement, with different reasons; `jail` fails before an artifact or runner/provider
invocation. This is intentionally weaker than upstream jailed execution and makes no Seatbelt,
Landlock, syscall, child-process, or containment claim.

## Remaining oracle and implementation gaps

- exact upstream run-record placement encoding and default-omission behavior;
- native jail capability probing and backend-selection precedence;
- macOS Seatbelt and Linux Landlock launcher receipts and denial evidence;
- explicit-jail errors and `auto` jail resolution on capable hosts;
- installed-package and CLI placement rendering parity;
- remote/cloud placement, which the pinned v0.2 scope excludes.

Until the launcher slice closes those gaps, TypeScript may report only advisory effective placement.
