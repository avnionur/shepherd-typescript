# Workspace Initialization and Adoption Research

Status: implementation input with explicit oracle gaps

Research date: 2026-08-11

Pinned shipped revision: `a8196d4c453514836d06bd2fece91a03cdc37107` (`v0.3.0`)

Pinned development revision: `d45074e0099d9ccafeed4a233702ad68ff8a2fa6`

## Reviewed primary sources

- [Generated Shepherd v0.3.0 CLI reference](https://docs.shepherd-agents.ai/reference/cli/)
- [Installed-package v0.3.0 quickstart](https://docs.shepherd-agents.ai/start/)
- [Pinned shipped source tree](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107)
- [Pinned development source tree](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6)
- [Repository-local upstream pin record](./upstream-baseline.md)

The CLI page identifies itself as generated, release-ready v0.3.0 documentation and names
`scripts/gen_cli_reference.py --check` as its validation command. The findings below therefore use
the generated command contract as the shipped public authority. The pinned trees establish the
review boundary; they do not by themselves prove unobserved internal behavior.

## Shipped command contract

The public command is:

```text
shepherd init [OPTIONS] [PATH]
```

`PATH` is the workspace root. The command creates or reuses `.vcscore`, validates the selected
workspace-control substrate, and leaves ordinary Git history untouched.

The exact options are:

| Option | Allowed values | Default | Contract |
| --- | --- | --- | --- |
| `--backend` | `auto`, `clonefile`, `fuse`, `kernel`, `copy` | `auto` | Select the filesystem carrier backend to validate. |
| `--adopt` | `none`, `git-head`, `worktree` | `worktree` | Select which existing project baseline enters Shepherd custody. |
| `--init-git` / `--no-init-git` | boolean pair | `--init-git` | Initialize Git only when `PATH` is not already inside a repository. |

Source: the [`shepherd init` generated help block](https://docs.shepherd-agents.ai/reference/cli/#shepherd-init).

The three adoption values are normative public vocabulary. Their names establish the following
minimum distinction without licensing stronger implementation guesses:

- `none`: do not record an existing project baseline into Shepherd custody;
- `git-head`: adopt the existing Git `HEAD` baseline;
- `worktree`: adopt the current working-tree baseline, and is the default.

The reviewed public help does not specify whether the index is part of `worktree`, how untracked or
ignored files are filtered, or the canonical record used for any mode. Those details require
pinned implementation tests before cross-language parity can be claimed.

## Git and idempotency requirements

The generated help provides two direct guarantees:

1. Initialization leaves ordinary Git history untouched.
2. `.vcscore` is created **or reused**.

The TypeScript implementation should therefore treat these as acceptance requirements:

- an existing repository must not receive a commit, ref move, checkout, reset, index rewrite, or
  configuration change merely because workspace initialization ran;
- `--init-git` may create repository metadata only when the target is not already inside a Git
  repository;
- `--no-init-git` must not create Git metadata;
- rerunning compatible initialization against an existing `.vcscore` must use that control root
  instead of destructively replacing it;
- an incompatible or malformed existing control root must fail closed rather than be silently
  rewritten.

Only the first three statements are direct consequences of the public help. Compatible-reuse and
fail-closed behavior are the minimum safe TypeScript interpretation of “creates or reuses”; exact
upstream error classes and mutation boundaries remain oracle work.

The v0.3.0 quickstart independently confirms that `sp.open(".")` refuses an uninitialized
directory with `WorkspaceControlError` and tells the caller to run `shepherd init`. This makes the
presence of an initialized control substrate, not merely a Git repository, the public open gate.
Source: [Getting Started, “If it fails”](https://docs.shepherd-agents.ai/start/#if-it-fails).

## `.vcscore` layout boundary

The reviewed public v0.3.0 material names `.vcscore` as the workspace control root but does not
publish a stable inventory of its files, directory layout, metadata schema, format version, or
atomic-write protocol. Consequently:

- `.vcscore` itself is normative;
- internal filenames and JSON shapes are not yet available as a public compatibility contract;
- the TypeScript implementation should define a versioned, closed metadata record and protect the
  entire control root from managed workspace changes;
- no specific upstream internal filename should be copied or claimed compatible until a fixture is
  extracted from the pinned release implementation and tests.

This is deliberately narrower than claiming that an arbitrary TypeScript `.vcscore` can be opened
by Python Shepherd v0.3.0.

## Unspecified edge semantics

The reviewed public sources do not define exact behavior for:

- dirty tracked files, staged-only changes, untracked files, ignored files, or unborn `HEAD` under
  each adoption mode;
- a target inside a parent repository versus a target containing a nested repository;
- Git worktrees, submodules, bare repositories, symlinked roots, and repository-root discovery;
- repeated initialization with changed `--backend` or `--adopt` values;
- partial initialization recovery and exact error taxonomy.

These cases must remain explicit conformance gaps. They should be resolved by running fixtures
against the pinned v0.3.0 implementation, not by treating ordinary Git intuition as Shepherd's
contract.

## Phase 3 Task 1 implementation contract

Implement the public seam with the following initial acceptance matrix:

1. Validate and canonicalize an explicit directory root.
2. Accept only configured adoption values and default adoption to `worktree`. Backend selection
   remains at the later carrier adapter boundary because Task 1 does not yet materialize worlds.
3. Create or safely reuse a protected `.vcscore` control root with versioned metadata.
4. Preserve all existing Git history and refs.
5. Respect `--init-git` only for targets outside a repository and respect `--no-init-git` exactly.
6. Record the requested adoption mode and the resolved baseline identity without inventing missing
   upstream semantics.
7. Fail closed on malformed control metadata or baseline evidence that cannot be read safely.
8. Test empty directories, initialized repositories, dirty worktrees, repeated initialization,
   and deterministic worktree identity. Parent-repository and nested-repository boundaries remain
   explicit oracle work rather than inferred parity.

The implemented Task 1 seam records a baseline citation only. Backend validation and durable byte
custody belong to the later carrier slice, so this task does not claim the upstream `--backend`
surface or a materialized retained world.

## Next evidence step

Before claiming shipped `0.3.0` parity for Task 1, extract and execute the pinned release's init
tests for all three adoption modes. Capture the resulting `.vcscore` tree, Git refs and index before
and after, second-run behavior, dirty worktrees, unborn `HEAD`, parent-repository targets, and nested
repositories. The resulting fixture manifest should cite
`a8196d4c453514836d06bd2fece91a03cdc37107` and distinguish public compatibility requirements from
TypeScript-owned safety policy.
