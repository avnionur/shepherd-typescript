# Security Policy

## Supported versions

The project is pre-release. Security fixes are applied to the latest commit on `main`; older
versions are not maintained unless a release announcement states otherwise. The
[support policy](./docs/support-policy.md) lists supported runtimes, platforms, and surfaces.

## Reporting a vulnerability

The repository is private, so GitHub's private vulnerability reporting form is not available.
Until the repository is public, email reports to
[avnionur@gmail.com](mailto:avnionur@gmail.com) with a subject that starts with
`[shepherd-typescript security]`. Do not open a public issue, discussion, or pull request for a
vulnerability.

Once the repository is public, the
[private GitHub security advisory](https://github.com/avnionur/shepherd-typescript/security/advisories/new)
form becomes the primary path; email stays available as a fallback. Enabling the form after the
repository becomes public is an owner action tracked in
[#199](https://github.com/avnionur/shepherd-typescript/issues/199) (finding F-009).

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
been performed yet (O-1, deferred to #199). The
[Phase 11 exit audit](./.plan/phase-11-exit-audit.md) records no unresolved critical or high
finding in the internal register; the internal review does not replace an external one.

## Security boundary

The repository contains the `CI` (`ci.yml`), `Dependency Audit` (`dependency-review.yml`, a
frozen, script-free install and `pnpm audit --audit-level=high`), and `CodeQL` (`codeql.yml`)
workflows, but no hosted workflow runs. On 2026-09-23 (#191) the owner enabled `CI` and
`Dependency Audit`; the dispatched `CI` run on `main` started no job because of an account billing
or spending-limit restriction, which only the owner can change, and the owner disabled both
workflows again. `CodeQL` was not enabled: code scanning on a private repository requires GitHub
Advanced Security, which is not available for this repository. No hosted run has passed, so there
are no hosted static-analysis or dependency-audit results (finding F-008); hosted runs are deferred
to [#199](https://github.com/avnionur/shepherd-typescript/issues/199). Verification is local:
`pnpm verify` and `pnpm build:desktop`, plus the local Docker Linux lane recorded in the
[Phase 11 exit audit](./.plan/phase-11-exit-audit.md#linux-verification-lane-and-close-out-2331).
Installation uses the frozen lockfile; dependency lifecycle scripts run only for packages
allowlisted under `allowBuilds`. Dependency and lockfile diffs require review.

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
