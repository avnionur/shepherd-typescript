# Protected Control Paths

Implementation:
[`src/workspace/protected-control-paths.ts`](../src/workspace/protected-control-paths.ts).
Public exports: [`src/index.ts`](../src/index.ts). Production-seam tests:
[`test/workspace/protected-control-paths.test.ts`](../test/workspace/protected-control-paths.test.ts)
and
[`test/workspace/reference-copy-selection-staging.test.ts`](../test/workspace/reference-copy-selection-staging.test.ts).

## Workspace protocol v18 contract

`inspectWorkspacePathProtection(options)` performs read-only validation of one portable path
relative to a canonical workspace binding. It returns frozen evidence containing the exact input,
the matched configured protected root or `null`, and the validation contract version.
`WorkspaceProtectedPathError` carries that evidence and the configured stable error code.

The policy is owned by `workspaces.protectedPaths` in `protocol.config.json`. Protected roots,
Unicode normalization, deterministic case folding, alternate-name separators, ignored trailing
characters, the error contract, and its version are configuration values. The loader requires the
configured workspace control directory to remain protected.

Comparison is conservative across supported hosts. A protected name remains protected after
configured Unicode normalization and case folding, after filesystem-ignored trailing characters,
and before an alternate-name separator such as a Windows stream suffix. The same rule applies at
any binding-relative depth. Existing path prefixes are resolved without following a candidate
leaf for mutation, so a symlink alias into protected control storage is also rejected.

## Retained-world enforcement

The reference copy carrier applies the policy while capturing a user binding, capturing or
verifying mutable custody, reopening immutable revisions, staging selection, executing or
recovering scheduled selection steps, and verifying discard cleanup. The initialized control root
itself is excluded from a workspace-root snapshot; alternate spellings and aliases are rejected
rather than copied.

Git-aware custody applies the same validator to tracked, untracked, and ignored path enumeration
and independently validates archive materialization. Exact configured control storage is excluded;
case-folded, alternate-name, nested, and symlink aliases fail before retained-world publication.

Selection validates the complete authenticated changeset before creating selection staging or
reading a user path. Recovery repeats that validation before interpreting a retained step prefix.
Discard retains its durable marker when custody cleanup cannot be verified and resumes only after
the protected-path violation is removed. Ordinary managed paths keep their existing capture,
inspection, selection, and cleanup behavior.

## Platform boundary

The comparison contract is deterministic on macOS, Linux, native Windows, and WSL rather than
depending on the host filesystem's current case mode. Tests exercise direct, nested, case-folded,
trailing-name, alternate-name, and symlink-alias candidates. Windows symlink creation may require
host privileges, so the lexical matrix supplies the portable Windows/WSL evidence while symlink
integration runs on hosts that permit directory links.

This contract protects Shepherd control metadata. It does not claim portable retention of ACLs,
extended attributes, resource forks, or arbitrary alternate data stream content; those broader
filesystem-preservation fixtures remain part of Phase 3 platform/fault conformance.
