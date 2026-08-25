# Generated CLI reference

This file is generated from `protocol.config.json`. Do not edit it directly.

Executable: `shepherd-ts`<br>
Human compatibility: `shepherd.cli.v1`<br>
JSON compatibility: `shepherd.cli.json.v1`<br>
JSON schema: `https://avnionur.github.io/shepherd-typescript/schemas/cli-output-v1.schema.json`

## Commands

- `shepherd-ts init`
- `shepherd-ts doctor`
- `shepherd-ts run list`
- `shepherd-ts run show`
- `shepherd-ts run changeset`
- `shepherd-ts run trace`
- `shepherd-ts run trace-revision`
- `shepherd-ts run output-citations`
- `shepherd-ts run outputs`
- `shepherd-ts run vcscore`
- `shepherd-ts run recovery-records`
- `shepherd-ts run select`
- `shepherd-ts run apply`
- `shepherd-ts run release`
- `shepherd-ts run discard`
- `shepherd-ts run repair`
- `shepherd-ts run start`
- `shepherd-ts task list`
- `shepherd-ts task show`
- `shepherd-ts task resolve`
- `shepherd-ts task register`
- `shepherd-ts demo write`
- `shepherd-ts package init`

## Options

- `--adopt`
- `--binding-name`
- `--binding-root`
- `--command`
- `--initialize-git`
- `--json`
- `--limit`
- `--max-bytes`
- `--no-initialize-git`
- `--offset`
- `--registry`
- `--read`
- `--store`
- `--workspace`

## Fenced or unavailable commands

- `shepherd-ts run start`: run start is fenced; use the public task execution APIs
- `shepherd-ts task register`: task register does not execute dynamic source modules; register through the public descriptor API
- `shepherd-ts package init`: package init requires the reproducible extension scaffold capability

## Offline demo

- `shepherd-ts demo write quickstart`: emits `examples/quickstart.mjs`

Pass `--json` anywhere in an invocation to emit one canonical JSON object followed by a newline. Successful output is written to stdout; errors are written to stderr. The envelope is bounded to 1048576 UTF-8 bytes and never includes error messages, stack traces, or resolved filesystem paths.
