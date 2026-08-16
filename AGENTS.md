# AGENTS.md — Shepherd TypeScript

Instructions for AI agents working in the Shepherd TypeScript repository.

---

## Changelog Requirement

After completing every task, you **must** update `CHANGELOG.md`.

1. Read the template at `./template/changelog-template.md`
2. Add a new entry to `CHANGELOG.md` following that template format
3. Check the skills from `.claude/skills`.

## Version Bumping (Semantic Versioning)

Every CHANGELOG update **must** be accompanied by a version bump — never append to an existing version's section. Before picking the number, classify what kind of change you made, then bump the matching component of `MAJOR.MINOR.PATCH`:

- **MAJOR** — a breaking change: removed or renamed public API, changed IPC channel or schema contract, pack YAML shape change that invalidates existing packs, settings key removal/rename, or any change that requires a user or downstream consumer to adapt.
- **MINOR** — a new feature or capability added in a backward-compatible way: new tool, new agent capability, new pack, new setting, new UI surface, new supported format.
- **PATCH** — a backward-compatible fix or internal-only change: bug fix, typo, docs, test-only change, refactor with no behavior change, dependency bump with no API impact.

Rules:

- When a task mixes kinds, the **highest applicable level wins** — a fix shipped alongside a new feature is a MINOR bump; anything breaking is MAJOR.
- Bumping a higher component **resets the lower ones to `0`** (e.g. `0.73.4` → `0.74.0` for a feature, → `1.0.0` for a breaking change).
- Never default to a patch bump out of habit. State which kind the change is, then bump accordingly.
- After bumping, update `cognia.version` in `release-config.yaml`, run `pnpm sync:version`, then `pnpm build:desktop`.

## No Hard-Coded Static Configuration

- Never hard-code values for anything that is statically configured, nor for specific named elements such as a particular agent, pack, phase, package, model, or KB path.
- Code must always be written using generic elements, patterns, or configuration-dependent logic — everything statically configurable resolves from a configuration file (for example `release-config.yaml`, `pack.yaml`, `settings.json`, or a `*.yaml` pack declaration), never from a literal baked into the source.
- If you find yourself about to write a domain-specific literal, move it to config and read it back through the loader.

## Preserve Existing Capabilities

- Before making a major change to the codebase, check the capabilities that were previously added and ensure the change does not lose or regress any of them.
- Review the surrounding code, `CHANGELOG.md`, and related features to inventory what already works, then verify every one of those capabilities still functions after the change.
- A refactor or rewrite must carry forward the full existing feature set — never drop a capability on your own initiative.
- For every feature, fix, refactor, dependency upgrade, or behavior-affecting configuration change, load and follow `.claude/skills/preserve-capabilities/SKILL.md` before editing and again before completion.
- Do not declare a high-risk capability preserved without evidence at its production seam or a documented, repeatable manual verification when no correct automated seam exists.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Use only erasable TypeScript syntax (Node strip-only mode) in code checked by the root config
  (`src` and `scripts`): no parameter properties, `enum`, `namespace`/`module`, `import =`,
  `export =`, or other constructs needing JavaScript emit. Use explicit fields with constructor
  assignments.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.

## JSDoc and Documentation

- Every public TypeScript type, function, class, method, and property must have JSDoc at its
  declaration.
- Public function JSDoc documents behavior, parameters, return values, thrown errors, and an
  example when usage is not obvious.
- Update `README.md` and `docs/README.md` whenever a public module or capability changes.
- Keep implemented and normative behavior in `docs/`; keep research and unfinished proposals in
  `.plan/`.
- Link implementation documentation to its public entry point and tests.
- Keep `.plan/tracker.md`, `CHANGELOG.md`, and the repository version current for every completed
  slice.
- Prefer small, cohesive documentation pages with explicit ownership over large mixed-purpose
  documents.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Dependency and Install Security

- Treat dependency and `pnpm-lock.yaml` changes as reviewed code — review lockfile diffs with the same rigor as source.
- Dependency lifecycle/build scripts run only for packages allowlisted under `allowBuilds` in `pnpm-workspace.yaml`. Never add an `allowBuilds` entry silently — a new dep that needs build scripts requires explicit user approval.
- To refresh the lockfile after metadata-only changes, use `pnpm install --lockfile-only`.
- Never add `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml` to bypass the release-age gate without explicit user approval.

## GitHub Issue Delivery Workflow

Use this workflow for every implementation issue. Each branch and pull request should deliver one
issue unless the issue explicitly defines a coordinated multi-issue slice.

1. **Select the next issue.** Work in dependency order. The issue must be open, all issues listed
   under `Blocked by` must be closed, and the parent phase must be active. Read the complete issue,
   parent epic, linked plan and normative documentation, and relevant comments before editing.
2. **Start from `main`.** Preserve unrelated user or agent work. If local changes prevent a safe
   branch switch, stop and ask instead of stashing, resetting, cleaning, or discarding them. Update
   `main` with a fast-forward-only pull, then create a new branch from it using the generic pattern
   `codex/phase-<phase>-<task>-<slug>`.
3. **Mark the issue in progress.** Use `gh` to replace `status:ready` with
   `status:in-progress` when applicable and add a short comment naming the branch and planned
   verification. Do not close or modify the parent epic except to maintain its tracking state.
4. **Implement the complete slice.** Follow the issue acceptance criteria and implementation
   contract. Add or update relevant tests, normative documentation, public API documentation,
   examples, `.plan/tracker.md`, `CHANGELOG.md`, and the semantic version. Do not defer required
   documentation or recovery/security evidence to an unrelated follow-up.
5. **Verify before review.** Run focused tests while implementing. Before opening the pull request,
   run `pnpm verify`, perform the required version synchronization, and run
   `pnpm build:desktop`. Review dependency and lockfile diffs when present. Record exact commands
   and results for the pull request and issue.
6. **Commit and push safely.** Follow the repository Git rules below, including asking before the
   commit, staging only explicit paths, and checking staged contents. Push the issue branch without
   force.
7. **Open a pull request into `main`.** Use `gh pr create` with the issue title or a concise scoped
   equivalent. The body must link the issue, use `Closes #<issue>` for a fully delivered task,
   summarize behavior and compatibility impact, list verification, identify documentation changes,
   and call out security, recovery, platform, provider, or migration limits.
8. **Update the issue.** After opening the pull request, add an issue comment with the PR link,
   delivered acceptance criteria, verification results, documentation links, and remaining risks.
   Keep labels and the parent epic accurate while checks or review are pending.
9. **Merge only when ready.** Wait for required checks and review requirements to pass, resolve
   actionable feedback, and use `gh pr merge` without force into `main`. Confirm that the task issue
   closed through the PR, then update the parent epic progress. Close a phase epic only after every
   exit criterion has verified evidence.
10. **Report the next task.** Synchronize local `main` after merge when safe, inspect open roadmap
    issues and their blocking edges, and tell the user which issue is the next unblocked task. If no
    issue is ready, report the exact blocker instead of selecting speculative work.

## Git

Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
  - Ask before commit!
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- Message format: `{feat,fix,docs}[(core,desktop,renderer,pack,agent,workflow,kb,tools,auth,gitflow,mcp)]: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

## Risky Shell Commands

Before executing destructive or irreversible shell commands, you **must** flag them as risky and ask for explicit user confirmation. Never run these without approval:

- `rm -rf` — recursive force deletion of files or directories
- `dd`, `mkfs`, `fsck` — disk-level operations
- `chmod -R 777`, `chown -R` — recursive permission/ownership changes
- `> /dev/sda`, `of=/dev/*` — writing directly to block devices
- `:(){ :|:& };:` — fork bombs or resource-exhaustion patterns
- `git push --force`, `git push --delete` — destructive remote branch operations
- `DROP`, `TRUNCATE`, `DELETE FROM ... WITHOUT WHERE` — destructive database operations
- Any command piped to `sh`, `bash`, or `eval` with untrusted or unclear input

If a user requests such a command, respond with: **"This is a risky operation. Are you sure you want to proceed?"** and wait for explicit confirmation before executing.
