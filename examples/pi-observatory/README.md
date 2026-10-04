# Pi chat and Shepherd observability

Run from the repository root on a supported Node runtime:

```sh
pnpm build:desktop
cp examples/pi-observatory/config.json examples/pi-observatory/config.local.json
node examples/pi-observatory/server.mjs examples/pi-observatory/config.local.json
```

Open the printed loopback URL. The default is an offline fixture with synthetic usage.
The UI has chat, an interactive evidence graph, record inspection, run/source/search filters,
animated live-follow arrows, causal playback, provider/model selectors, a window-filling canvas,
run/record explanations, zoom/pan/Fit and native trace export. Prompts and replies are retained plaintext locally.

The [engineering guide](../../docs/pi-observatory.md) covers pinned Pi/AppGraph research,
configuration, optional Pi installation/authentication, graph semantics, cancellation/recovery,
safety boundaries, tests and extension guidance. Pi tools and extensions are disabled by default;
this example observes RPC events and does not govern Pi tool execution.

```sh
node --test examples/pi-observatory/test/http.test.mjs examples/pi-observatory/test/graph.test.mjs
```

## Configure a real provider

```sh
npm ci --prefix examples/pi-observatory/sdk --ignore-scripts
```

In the browser select **Pi · live provider**, choose Provider and Model, enter your API key,
then **Save key & connect**. The field clears after submission. Keys are saved by Pi's native
locked credential store in the configured private `pi-state` directory, never browser storage,
trace/export, responses or argv. This is private plaintext storage, not an OS keychain.
**Refresh providers** retries setup without restart. **Offline playground** retains the demo.
The optional helper pins Pi 1.0.0; existing configured external Pi RPC remains supported.
OAuth/multi-prompt setup may require Pi's separate login flow.

Choose **Ollama** to discover models already installed on the configured local server, then
**Connect local model** (no API key). Cloud-tagged models may require Ollama cloud login.
Click the canvas and use arrow keys to pan. **Clear canvas / new trace** starts a fresh chat and
graph while retaining the previous SQLite file and provider settings. Export first for easy recovery.
