# Offline retained-output quickstart

Implementation fixture: [`examples/quickstart.mjs`](../examples/quickstart.mjs). CLI implementation:
[`src/cli/handlers.ts`](../src/cli/handlers.ts). Installed-package conformance:
[`tooling/testing/packaged-cli.ts`](../tooling/testing/packaged-cli.ts).

Create a fresh directory, install the package into it, emit the checked-in demo, and run it. The
package is not published to npm, so install a locally packed tarball (see the
[README](../README.md#installation)):

```sh
mkdir shepherd-typescript-demo
cd shepherd-typescript-demo
npm install /path/to/avnionur-shepherd-typescript-<version>.tgz
npx shepherd-ts demo write quickstart > quickstart.mjs
node quickstart.mjs
```

Expected output:

```text
['NOTE.txt']
Hello from a Shepherd retained output.
```

The script initializes the directory as a workspace with `none` adoption and no Git creation, then
binds only the dedicated `quickstart-workspace/` subdirectory, which it creates. It never binds the
whole working directory, so a local `node_modules` beside the script is not captured. It declares a
bodyless task, uses the deterministic static provider, writes `NOTE.txt` inside isolated retained
custody, and verifies the user file is absent. It then inspects and prints the retained proposal,
prepares exact selection, selects once, and verifies the selected bytes at
`quickstart-workspace/NOTE.txt`. The printed and inspected paths are relative to that binding.

From 2.36.0 the flow takes about a second and retains a few hundred kilobytes under `.vcscore`.
Earlier versions bound the whole directory; after a local install they captured `node_modules`
and took over a minute with tens of megabytes of retained state.

The durable trace store is `.vcscore/quickstart-trace.sqlite`. Inspect it without mutation:

```sh
shepherd-ts run show run:quickstart --store .vcscore/quickstart-trace.sqlite --json
shepherd-ts run output-citations --store .vcscore/quickstart-trace.sqlite --json
shepherd-ts run outputs --store .vcscore/quickstart-trace.sqlite --json
shepherd-ts run changeset @latest --workspace . --store .vcscore/quickstart-trace.sqlite --json
shepherd-ts run vcscore @latest --store .vcscore/quickstart-trace.sqlite --json
shepherd-ts run trace --store .vcscore/quickstart-trace.sqlite --json
```

This quickstart is offline and keyless. Its runner reports advisory in-process enforcement; it
does not claim a native jail.

The installed-package test runs the documented flow in a fresh consumer directory that holds its
own `node_modules` installed from the packed tarball. It emits the script through that installed
binary, runs it, checks the transcript and the selected file inside the binding directory, and
asserts the budgets in the `quickstart` section of
[`config/runtime-verification.config.json`](../config/runtime-verification.config.json): the binding
directory the emitted script must declare, the maximum wall time for `demo write` plus
`node quickstart.mjs`, and the maximum total file bytes under `.vcscore`. It then reads the
resulting exact run/output/trace evidence through stable CLI JSON.
