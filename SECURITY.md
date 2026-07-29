# Security Policy

## Supported versions

The project is pre-release. Security fixes are applied to the latest commit on `main`; older
versions are not maintained unless a release announcement states otherwise.

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

## Security boundary

The project can only reverse state owned by a supported trace, workspace, process, provider, or
compensation backend. It cannot inherently reverse external network actions, sent messages,
consumed API cost, leaked credentials, or unsupported host state.

An advisory placement is not an operating-system sandbox. Any placement described as jailed must
fail closed when enforcement is unavailable.
