# Naming and Licensing

This project is an independent implementation of Shepherd concepts and protocols. It is not
affiliated with or endorsed by the upstream Shepherd Authors.

## Project identity

| Surface | Name |
| --- | --- |
| Repository and display name | Shepherd TypeScript |
| npm package | `@avnionur/shepherd-typescript` |
| CLI executable | `shepherd-ts` |
| Python distribution | `shepherd-typescript` |
| Python import | `shepherd_ts` |

The npm name is configured in `package.json`. CLI and Python names are configured in
`project.config.json`. No unscoped `shepherd` package or executable compatibility alias is
authorized. A future alias requires a separate legal, ecosystem-conflict, and migration review.

An npm registry query returned no public package for `@avnionur/shepherd-typescript` on 2026-07-29.
No indexed PyPI result was found for `shepherd-typescript`. These observations do not reserve either
name; availability and account permissions must be checked again immediately before publication.

## License

Original work in this repository is licensed under the [MIT License](../LICENSE). The
repository's [NOTICE](../NOTICE) records upstream attribution and reuse boundaries.

The upstream Shepherd source is also MIT-licensed. When code or documentation is copied or
substantially derived, preserve the applicable upstream copyright and license notice. Do not assume
the code license covers paper prose, diagrams, trademarks, logos, or other brand assets.

## Publication boundary

Naming and licensing are resolved, but publication remains disabled. Before removing
`"private": true`, the project must:

1. define correct JavaScript and declaration export maps;
2. verify packed-package consumption in supported ESM and TypeScript fixtures;
3. freeze supported Node and TypeScript versions;
4. verify the package allowlist includes license, notice, README, built runtime, and required
   runtime configuration without internal settings, plans, tests, or tooling;
5. recheck registry availability and namespace permissions.
