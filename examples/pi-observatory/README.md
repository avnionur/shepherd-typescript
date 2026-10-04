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
