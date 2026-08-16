# Workspace Platform and Fault Conformance

Implementation: [`src/workspace/platform-conformance.ts`](../src/workspace/platform-conformance.ts).
Public exports: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/platform-fault-conformance.test.ts`](../test/workspace/platform-fault-conformance.test.ts),
[`test/workspace/git-aware-custody.test.ts`](../test/workspace/git-aware-custody.test.ts), and
[`test/workspace/retained-world-select.test.ts`](../test/workspace/retained-world-select.test.ts).

## Public policy inspection

Workspace protocol v19 adds `inspectWorkspacePlatformConformance({ workspaceRoot })`. It reopens
the initialized workspace and returns frozen configured evidence for the current host. The evidence
states the metadata, case-collision, mode, symlink, Git, and optimized-carrier parity policies; it
does not infer support from an attempted publication.

The reference manifest retains regular-file bytes, relative symlink text, and the portable low nine
mode bits. ACLs, extended attributes, macOS resource forks, and Windows alternate data streams are
not represented. Platform-specific probes therefore reject any such metadata before snapshot or
custody-capture publication. A missing or failed required probe also fails closed as an unsupported
platform. The system-owned macOS `com.apple.provenance` audit marker is explicitly non-semantic and
excluded; user and resource-fork attributes still fail closed. CI installs the Linux `acl` and
`attr` probes; macOS and Windows use native tools.

Names are compared after configured Unicode normalization, case folding, alternate-name splitting,
and trailing-character removal. Distinct host entries that collapse to one portable name are
rejected before publication. Relative, contained symlink targets and portable modes remain covered
by the reference-carrier suite.

## Git policy

Worktree custody rejects a regular-file placeholder for an index entry with mode `120000` when
`core.symlinks=false`; treating placeholder text as ordinary bytes would change the retained-world
meaning. Sparse and sparse-index worktrees retain exact opaque index bytes, canonical index-entry
evidence, sparse configuration and pattern digests, and the intentional absence of skipped paths.
Clean Gitlinks remain external commit citations and do not become copy-world entries. Existing mode,
symlink, sparse, and Gitlink tests are part of the same reference evidence.

## Stable fault and recovery evidence

`ReferenceCopyCarrierOptions` and `GitAwareCustodyOptions` accept an optional exact
`faultInjection` fixture for conformance tests. A matching configured boundary raises
`WorkspaceCustodyFaultError` with a stable code and frozen `WorkspaceCustodyFaultEvidence`:

- classification and optional underlying system code;
- exact custody or selection phase;
- required recovery behavior;
- unsupported metadata kind when applicable; and
- platform-conformance protocol version.

The configured classifications cover permission denial, capacity exhaustion, concurrent mutation,
interruption, unsupported metadata, unsupported platform behavior, and general I/O failure.
Pre-publication faults remove staging and publish no revision or custody receipt. A reference
revision interrupted after publication can be reopened by its deterministic identity, and equal
retry converges. Selection faults before the first write leave user bytes unchanged; faults after
carrier receipt publication leave the store journal honestly `applying` with no terminal receipt.
Normal restart retry validates the retained prefix and converges to one selected terminal result.

Fault injection is a deterministic test seam, not a production toggle or a substitute for host
errors. Callers should omit it outside conformance tests.

## Optimized carrier parity

The reference carrier remains the correctness oracle. An optimized carrier must pass the same
platform, metadata, identity, fault-boundary, recovery, Git, and settlement-receipt suite before it
can claim parity. No optimized carrier is registered or reported as conformant by this release.
