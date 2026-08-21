# Placement Resolution Research

Status: Phase 4 Tasks 3-4 implemented oracle record

Research date: 2026-08-21

Pinned shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

## Reviewed primary evidence

- [pinned placements concept](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/docs/shepherd/concepts/placements.md)
- [pinned ambient world-access refusal tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/runtime/tests/unit/nucleus/test_placement_refusal.py)
- [pinned dialect placement-refusal verification](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_placement_refusal_dialect_lane.py)
- [pinned confinement lowering](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/src/shepherd_dialect/confinement.py)
- [pinned per-binding confinement tests](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_per_binding_confinement.py)
- [pinned Seatbelt containment backend](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/vcs-core/packages/core/src/vcs_core/_seatbelt_containment.py)
- [pinned Landlock containment backend](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/vcs-core/packages/core/src/vcs_core/_landlock_containment.py)
- [pinned macOS jailed run fixture](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_jailed_run.py)
- [pinned Linux jailed run fixture](https://github.com/shepherd-agents/shepherd/blob/a8196d4c453514836d06bd2fece91a03cdc37107/shepherd/packages/dialect/tests/test_jailed_run_linux.py)

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

Placement-v1 remains unchanged: advisory resolves explicitly, auto records an advisory fallback,
and jail refuses without fabricating evidence. Workspace protocol v23 adds separate native-jail
backend, probe, command, resolution, confinement-plan, and process artifacts. Auto reaches native
jail only through a successful package-authenticated probe; unavailable hosts retain the visible
placement-v1 advisory fallback.

The TypeScript Seatbelt lowering follows the pinned deny-all-write plus canonical writable-root
allows. The Landlock helper follows the pinned self-restrict-before-exec design and write-access
mask, but is implemented as a package-owned C helper compiled and digest-verified from fixed source
because Node exposes no direct Landlock syscall API. TypeScript additionally owns structured argv/
environment bounds, process-group quiescence, durable launch intent/start/receipt evidence, and
no-retry uncertain interruption because the pinned Python code supplies no language-neutral
artifact or recovery contract for those concerns.

## Remaining oracle and implementation gaps

- exact upstream run-record placement encoding and default-omission behavior;
- installed-package and CLI placement rendering parity;
- remote/cloud placement, which the pinned v0.2 scope excludes.
- native Windows/AppContainer, which is explicitly unsupported in protocol v23;
- simultaneous multi-binding custody and network/read confinement, which are outside the native
  filesystem-write boundary.

Native enforcement is reported only by the authenticated v23 adapter. Platform evidence or an
ordinary runner cannot claim it.
