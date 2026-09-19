# Security Policy

## Supported versions

The project is pre-release. Security fixes are applied to the latest commit on `main`; older
versions are not maintained unless a release announcement states otherwise. The
[support policy](./docs/support-policy.md) lists supported runtimes, platforms, and surfaces.

## Reporting a vulnerability

Use a
[private GitHub security advisory](https://github.com/avnionur/shepherd-typescript/security/advisories/new).
If that form is unavailable, open a
[contact-request issue](https://github.com/avnionur/shepherd-typescript/issues/new)
containing only a request for a private security contact. Do not include vulnerability details in
the issue.

Include:

- affected commit or version;
- impact and required preconditions;
- a minimal reproduction or proof of concept;
- affected operating systems and runtimes;
- suggested mitigation, if known;
- whether disclosure is time-sensitive.

Do not include real secrets, credentials, private repositories, or third-party data. Maintainers
will acknowledge the report when practical, investigate it privately, and coordinate remediation
and disclosure based on severity. This policy does not promise a fixed response time.

Reports are triaged with the severity rubric in the
[internal security review](./.plan/security-review.md#severity-rubric) and handled under
[incident response](./docs/incident-response.md). The [threat model](./docs/threat-model.md)
defines the assets, trust boundaries, and known residual risks. No external security review has
been performed yet. The [Phase 11 exit audit](./.plan/phase-11-exit-audit.md) (2.32.4) records no
unresolved critical or high finding in the internal register; the internal review does not replace
an external one. Enabling the private advisory form is an owner action that is not yet confirmed
(finding F-009); until it is, use the contact-request path above.

## Security boundary

The repository contains a lockfile-based dependency audit (`pnpm audit --audit-level=high`),
CodeQL, and dependency-review workflows under `.github/workflows/`, but hosted CI is currently
disabled by the owner, so these workflows do not run. Verification is local: `pnpm verify` and
`pnpm build:desktop`. Installation uses the frozen lockfile; dependency lifecycle scripts run only
for packages allowlisted under `allowBuilds`. Dependency and lockfile diffs require review.

Trace store files are protected by operating-system permissions only. Blob files are created
owner-only; from 2.27.0 writable opens also create and tighten the SQLite database and its WAL and
SHM files to the configured owner-only mode (finding F-003, fixed). Canonical records are
immutable: do not append secrets to a store. Open stores with `secretScanning: "refuse"` to reject
configured secret classes before any write, and share redacted archives rather than native exports
([secrets and retention](./docs/secrets-and-retention.md)).

The project can only reverse state owned by a supported trace, workspace, process, provider, or
compensation backend. It cannot inherently reverse external network actions, sent messages,
consumed API cost, leaked credentials, or unsupported host state.

An advisory placement is not an operating-system sandbox. Any placement described as jailed must
fail closed when enforcement is unavailable.
