# Packaged TypeScript examples

The [retained-coding example](../examples/retained-coding.ts) is a standalone Node TypeScript
consumer of the supported tasks, providers, runs, trace, and workspace package entries.
Its [scenario](../examples/retained-coding.json) owns the sample names, identities, filenames,
instruction, and source bytes. It makes no live model request and requires no credentials.

## Run from a source checkout

With the repository prerequisites installed:

```sh
pnpm build
node examples/retained-coding.ts ./coding-demo examples/retained-coding.json
```

The destination must not exist. The example creates it exclusively and refuses an existing
directory, including an existing checkout or a previous demo. It does not delete anything on
failure: retained state remains available for inspection. Choose a new destination for another run;
re-running this teaching example is not a recovery operation.

## Run from an installed tarball

Publication is still disabled. Build and pack the repository, then install that tarball in a
separate consumer directory. Copy the example outside `node_modules` because Node does not strip
TypeScript inside dependency directories:

```sh
npm install /absolute/path/to/avnionur-shepherd-typescript-1.61.0.tgz
npm pkg set type=module
cp node_modules/@avnionur/shepherd-typescript/examples/retained-coding.ts .
cp node_modules/@avnionur/shepherd-typescript/examples/retained-coding.json .
node retained-coding.ts ./coding-demo retained-coding.json
```

Use Node 24 or newer. The `cp` commands are POSIX shell examples; on Windows copy the same two files
with your shell or file manager. No transpilation step is needed to execute the copied example.

## What it proves

The example seeds a greeting function in a new directory, constructs an inferred object-input and
string-output task, and supplies an exact offline provider cassette. Its advisory retained-world
runner reads the original source from custody, executes the task, validates the returned source,
and writes only through the fenced world interface.

After capture, changeset inspection reads the proposed source from the retained revision. The
example checks that the user source still contains the original bytes. The explicit prepare/select
calls then publish that exact output. This demo automatically reaches those calls: it is not an
interactive human-approval prompt. In an application, put your approval policy at that marked point.

The JSON transcript contains:

- `changedPaths`: `["greet.ts"]`;
- `beforeSelection`: the original source returning `"Hello"`;
- `retainedSource` and `afterSelection`: the personalized source shown below;
- `runStatus`: `"committed"`;
- `settlementStates`: `["selected"]`, read after reopening the trace store read-only.

```ts
export function greet(name: string): string { return "Hello, " + name + "!"; }
```

The trace database remains in the workspace control directory with the filename from the scenario.
The example checks exact output identity on the reopened settlement citation. It does not claim
native confinement, arbitrary code execution, live-provider coding quality, or automatic recovery
after an interrupted invocation. See the repository's
[durable execution](https://github.com/avnionur/shepherd-typescript/blob/main/docs/durable-task-execution.md)
and [settlement](https://github.com/avnionur/shepherd-typescript/blob/main/docs/retained-world-settlement.md)
contracts for recovery authority (repository access is required).

## Verification and adding examples

`package.json.exampleManifest` selects the shipped [example manifest](../examples/manifest.json).
Each entry names a source and scenario plus independently specified expected JSON and final files.
The repository's [installed verifier](https://github.com/avnionur/shepherd-typescript/blob/main/tooling/testing/packaged-examples.ts), invoked by
[`pnpm test:package-cli`](https://github.com/avnionur/shepherd-typescript/blob/main/tooling/testing/packaged-cli.ts), copies those artifacts from a fresh
tarball installation, checks them against the checkout, typechecks against installed declarations,
runs them in a new isolated consumer, checks the transcript and final bytes, and verifies refusal
of an existing destination. Example code is not emitted into the production runtime.

New compatible examples extend the manifest rather than adding named branches to the verifier.
The original [offline quickstart](https://github.com/avnionur/shepherd-typescript/blob/main/docs/quickstart.md)
remains unchanged and is tested separately.
Multiple-binding and custom-effect examples remain tracked follow-ups.

## Review existing retained output

After the retained-coding command has completed, run:

```sh
node examples/read-only-review.ts ./coding-demo examples/read-only-review.json
```

For an installed consumer, copy `read-only-review.ts` and `read-only-review.json` out of the
package's examples directory just as above, then use those local filenames. Both examples use
only supported installed package entries.

The [review example](../examples/read-only-review.ts) opens an existing workspace and current
trace database read-only. The [review configuration](../examples/read-only-review.json) selects
the latest retained output, a file, a page limit, and preview byte/line limits. Limits are positive
integer strings parsed and checked before inspection; the public inspection interface also enforces
its configured bounds. An exact output ID can replace `@latest` to fix the review target.

For the default scenario the JSON response names `run:retained-coding`, lists `greet.ts`, reports
one change with no next page, and shows the personalized source without truncation. The existing
settlement state is `selected` because the setup example already selected it. Review only reports
that state; it never prepares, selects, releases, or discards an output. The same public inspection
also reads existing unsettled output when supplied an appropriate workspace and selector.

The review compares the public trace archive before and after inspection. Installed conformance
runs the review in a separate process twice, compares the expected transcript, and checks every
workspace/control file's bytes and directory membership before and after. The original setup's
existing-directory refusal remains independently tested.

The trace handle enforces read-only SQLite access. The reference carrier exposes a broader
interface, but the example uses only reopening existing revisions and inspection. Carrier setup
may ensure internal directories exist, so this example requires an intact captured workspace.
It is not a capability-limited carrier handle, a native sandbox, live observation, or recovery.
Missing/corrupt evidence causes failure; review does not repair it.
