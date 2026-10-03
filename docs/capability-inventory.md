# Capability inventory maintenance

The [generated inventory](./generated/capability-inventory.md) is the current evidence map for
[epic #235](https://github.com/avnionur/shepherd-typescript/issues/235). Its owner is the
[reviewed configuration](../config/capability-inventory.config.json), generated through
[`generateCapabilityInventory`](../tooling/capability-inventory.ts) and the
[command adapter](../scripts/capability-inventory-cli.ts). Regression evidence:
[`capability-inventory.test.ts`](../test/capability-inventory.test.ts).

Each row names its source category, actual public package exports, evidence files, outstanding
issues, and seven independent boundaries: API availability, composition, restart recovery,
live-provider evidence, performance, platforms, and formal claims. There is no aggregate coverage
percentage. Historical milestone completion does not close newly discovered integration gaps.

## Updating a claim

1. Read the implementation, public entry, cited tests and normative contracts; revise the claim
   and issue links in the configuration. Do not mark unavailable live or platform evidence passed.
2. If a cited file changed, review its diff and update only that file's SHA-256 pin after checking
   that the linked claim still holds. The generator intentionally does not refresh evidence pins.
3. Run `pnpm generate:capabilities` to build declarations and regenerate the inventory. The
   generator rejects exports absent from the emitted package surface, missing/changed evidence,
   duplicate row identities, unknown groups, incomplete dimensions and escaping file paths.
4. Run `pnpm check:capabilities` and `node --test test/capability-inventory.test.ts`; run the changed
   capability's own tests and the repository `pnpm verify` gate. Both parallel and serial verify
   include the inventory check after the declaration build.

The stale-claim regression changes an API claim while keeping its evidence references intact and
requires the ordinary check to fail against the checked-in document. Other regressions remove an
export, invalidate an evidence digest and omit a dimension. This proves mechanical drift detection,
not semantic correctness: a reviewer must assess whether the evidence actually supports the prose.
File hashes detect changes to the cited file, not all transitive implementation dependencies.

## Evidence interpretation

Test source pins identify executable specifications. A check of their hashes does not execute them
or certify their latest outcome. `pnpm verify` executes the ordinary repository suite; opt-in live
providers, external proof builds and additional platform lanes need their own recorded commands,
hosts and results. Existing benchmark artifacts describe only their recorded hosts and workloads.

The upstream release baseline remains pinned to 0.3.0. Paper v3 is a research target, not a statement
that the upstream release or this package implements every experiment. Imported proof artifacts
and reference-machine validation do not prove arbitrary production agents correct. Native exact-ID
settlement, authority and operational APIs retain their own documented contracts.
