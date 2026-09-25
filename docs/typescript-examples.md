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
npm install /absolute/path/to/avnionur-shepherd-typescript-2.0.0.tgz
npm pkg set type=module
cp node_modules/@avnionur/shepherd-typescript/examples/retained-coding.ts .
cp node_modules/@avnionur/shepherd-typescript/examples/retained-coding.json .
node retained-coding.ts ./coding-demo retained-coding.json
```

Use Node >=24.12.0 <27. The `cp` commands are POSIX shell examples; on Windows copy the same two files
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
is tested separately.
The custom-effect example below completes the initial four-example collection.

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

## Separate bindings and settlements

Run the [multiple-binding example](../examples/multiple-bindings.ts) with its
[scenario](../examples/multiple-bindings.json) and a new destination:

```sh
node examples/multiple-bindings.ts ./bindings-demo examples/multiple-bindings.json
```

Installed consumers copy these two files out of the package's examples directory before executing
them, as with the retained-coding example. The destination must not exist. The scenario owns the
binding names, subdirectories, contents, and task/run/capture/settlement identities.

The example creates disjoint application and documentation binding roots. Each runner receives
one binding and performs one independent capture, sequentially. Both captures complete before
either is selected. Every capture verifies that all user files still contain their original bytes.
The program then selects each exact output separately and checks the complete user-file state:

| Moment | Application | Documentation |
| --- | --- | --- |
| Both captures retained | Original | Original |
| Application selected | Updated | Original |
| Documentation selected | Updated | Updated |

The JSON transcript records this sequence and one selected settlement per run, verified after
reopening the trace database read-only. The installed manifest supplies independent expected
transcript and final-file values. Existing-directory refusal is also tested.

This demonstrates multiple disjoint bindings, not a simultaneous multi-world runner, an atomic
multi-binding transaction, or an operating-system sandbox. Each selection has its own explicit
approval point and durable identity. The demo automatically selects each output at those points.
If a later selection fails, an earlier completed selection remains committed; use the documented
settlement/recovery interfaces for the affected output. Rerunning this setup program refuses the
existing destination and does not attempt recovery.

## Custom effect handlers

Run [custom-effects.ts](../examples/custom-effects.ts) with its
[scenario](../examples/custom-effects.json):

```sh
node examples/custom-effects.ts ./effects-demo examples/custom-effects.json
```

Installed consumers copy the two files out of the package before running them. The new empty
directory is only a demo-run marker; existing destinations are refused. The handlers themselves
perform pure text formatting and make no filesystem, provider, or network calls.

The example constructs a typed text payload, installs fallback and local handlers for the same
kind, then installs an unrelated kind. Dispatch chooses the last matching handler, not merely the
last installed handler. The local handler validates the application payload schema and returns
either formatted text or explicit failure data. Canonical validation alone does not establish
application-specific payload semantics.

Expected response fields:

- `successHandler` and `failureHandler`: `format:local`;
- `success`: `{"ok":true,"value":"Reviewed: sample"}`;
- `failure`: `{"ok":false,"error":{"code":"CONTENT_DECLINED"}}`;
- `manualOutcomeCorrelated` and `changedIntentRejected`: `true`;
- `unhandledCode`: `EFFECT_HANDLER_NOT_FOUND`.

The example validates correlations for both dispatch results, constructs a manual outcome, and
proves that reusing its effect ID with a different payload does not satisfy correlation. An
unhandled kind throws the exported error with the original kind and effect ID. The manifest's
independent expected response is checked after typechecking and running the installed example.

Handler dispatch is in-process and non-durable. It creates no trace-store records, recovery
journal, provider execution, interception, or replay facility. The reversible annotation describes
this pure operation; it does not implement compensation for arbitrary external effects. Explicit
failure data and thrown handler errors are distinct: the latter propagate to the caller. None of
these interfaces confines callback filesystem or network authority.
