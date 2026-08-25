# Offline retained-output quickstart

Implementation fixture: [`examples/quickstart.mjs`](../examples/quickstart.mjs). CLI implementation:
[`src/cli/handlers.ts`](../src/cli/handlers.ts). Installed-package conformance:
[`scripts/test-packaged-cli.ts`](../scripts/test-packaged-cli.ts).

Install the package, create a fresh directory, emit the checked-in demo, and run it:

```sh
mkdir shepherd-typescript-demo
cd shepherd-typescript-demo
shepherd-ts demo write quickstart > quickstart.mjs
node quickstart.mjs
```

Expected output:

```text
['NOTE.txt']
Hello from a Shepherd retained output.
```

The script initializes the directory with `none` adoption and no Git creation. It declares a
bodyless task, uses the deterministic static provider, writes `NOTE.txt` inside isolated retained
custody, and verifies the user file is absent. It then inspects and prints the retained proposal,
prepares exact selection, selects once, and verifies the selected user bytes.

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
does not claim a native jail. The installed-package test packs and installs the tarball into an
isolated consumer root, emits the script through the installed binary, executes it with the
installed ESM root only, checks the transcript and selected file, and reads the resulting exact
run/output/trace evidence through stable CLI JSON.
