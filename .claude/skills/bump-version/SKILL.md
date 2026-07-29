---
name: bump-version
description: Bump cognia release version
disable-model-invocation: true
---

Check CHANGELOG.md latest version number, then update the release config file @release-config.yaml cognia.version the latest version

then Run `pnpm sync:version`, then run `pnpm build:desktop`

check if there is any issue, tell the user to fix.