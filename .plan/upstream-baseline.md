# Upstream Compatibility Baseline

Captured: 2026-07-29

Machine-readable lock: [`upstream.lock.json`](../upstream.lock.json)

## Pinned revisions

| Surface | Git reference | Revision |
| --- | --- | --- |
| Moving development baseline | `refs/heads/main` | `d45074e0099d9ccafeed4a233702ad68ff8a2fa6` |
| Shipped compatibility baseline | `refs/tags/v0.3.0` | `a8196d4c453514836d06bd2fece91a03cdc37107` |

The revisions were resolved directly from the upstream Git repository with:

```sh
git ls-remote https://github.com/shepherd-agents/shepherd.git \
  refs/heads/main refs/tags/v0.3.0
```

Repository policy requires explicit review before replacing either revision with moving `main`.
Automated lock enforcement has not been implemented yet.

## Evidence set

The baseline uses primary upstream sources:

- [source tree at the pinned development revision](https://github.com/shepherd-agents/shepherd/tree/d45074e0099d9ccafeed4a233702ad68ff8a2fa6);
- [source tree at the shipped tag revision](https://github.com/shepherd-agents/shepherd/tree/a8196d4c453514836d06bd2fece91a03cdc37107);
- [workspace manifest at the pinned development revision](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/pyproject.toml);
- [license at the pinned development revision](https://github.com/shepherd-agents/shepherd/blob/d45074e0099d9ccafeed4a233702ad68ff8a2fa6/LICENSE);
- [paper v3](https://arxiv.org/html/2605.10913v3).

At capture time, the workspace manifest identifies release `0.3.0`, requires Python 3.11 or
newer, and lists the Shepherd, kernel-reference, `vcs-core`, and `commons-vcs` workspaces. The
upstream repository license is MIT.

The hosted [`0.3.0` roadmap](https://docs.shepherd-agents.ai/roadmap/) was also reviewed on the
capture date. Its URL is live and mutable, so it is supporting context rather than revision-pinned
evidence. Compatibility claims must not depend on its content without a permitted snapshot or an
equivalent source file pinned to a Git revision.

## Compatibility boundary

This pin establishes provenance; it does not claim parity. Compatibility is divided into:

1. shipped `0.3.0` behavior at the release revision;
2. development architecture at the pinned `main` revision;
3. research behavior defined by paper v3.

Claims require executable fixtures or tests against the corresponding surface. Documentation,
package layout, or naming alone is supporting evidence, not conformance proof.

The temporary full-source clone was not authorized during this capture. Therefore this slice
records Git references and the reviewed public evidence set, but does not claim a complete
line-by-line source audit or upstream test execution.

## Drift procedure

To update the baseline:

1. resolve upstream refs without modifying this lock;
2. compare the new revision with the pinned revision;
3. classify source, documentation, CLI, and schema changes;
4. update compatibility fixtures before changing claims;
5. review and commit the lock change explicitly.

Never update `upstream.lock.json` as an incidental dependency or build operation.
