# Pi chat and Shepherd observability engineering guide

Implemented example: [`examples/pi-observatory/server.mjs`](../examples/pi-observatory/server.mjs).
Issue [#275](https://github.com/avnionur/shepherd-typescript/issues/275). This is a local chat and
trace-inspection example. It adds no core API, runtime dependency, protocol migration, or tool authority.

## Run offline

Use a supported Shepherd Node runtime (`>=24.12.0 <27`; verified Node 24.17.0 here) and pnpm 10.
From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build:desktop
cp examples/pi-observatory/config.json examples/pi-observatory/config.local.json
node examples/pi-observatory/server.mjs examples/pi-observatory/config.local.json
```

Open the loopback URL printed by the server (default `http://127.0.0.1:4317`). Send a message;
the offline reply is explicitly a synthetic fixture. Its configured zero usage is fixture data,
not a token estimate. Each successful offline turn creates six Shepherd lifecycle/usage/outcome/cut records and two
separate fixture observations. Select any node to inspect its exact evidence. Search by schema,
source event or record ID; filter by run or source, drag to pan, zoom, Fit, and export the native
trace archive. Ctrl-C stops an active invocation, waits for cleanup, closes admitted HTTP connections, then closes SQLite.

The example is shipped in the local package's `examples/` directory. It also works there after
installing a locally packed Shepherd tarball: invoke `server.mjs` with an absolute configuration
path. No dev server, bundler, browser library, external font, CDN or Pi install is required offline.

## Example playground

The expanded playground offers five one-click items: successful turn, provider failure,
cancellation (slow turn then Stop), follow-up context and literal HTML-like text. Items come from
`playground` in configuration: distinct ID, title, description, message, offline behavior and delay.
`POST /api/chat` accepts either `{text}` or an exact `{itemId}`, with optional catalog `{model:{provider,id}}`; the server resolves cases from
trusted config and refuses unknown IDs. Failure injection is offline-only. Live reply items send
real configured prompts and may incur provider usage; offline delays do not alter Pi behavior.
A cancellation item is a guided Stop exercise, not a claim that live latency is controllable.

## Enable Pi

Research pins, inspected on 2026-10-04:

| Project | Revision | Relevant finding |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi/tree/200387122ca450d6387f033949423114a270b96c) | `200387122ca450d6387f033949423114a270b96c` | Current package is `@earendil-works/pi-coding-agent` 1.0.2, Node >=22.19.0; this example follows Shepherd's higher floor. |
| [AppGraph](https://github.com/hi77x/appgraph/tree/71de889c8b7f361be5d9eeee9011096b404d3f91) | `71de889c8b7f361be5d9eeee9011096b404d3f91` | Architecture graph UX reference, not a runtime trace collector. |

Package/version provenance: [Pi package metadata](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/package.json).
Install Pi separately if wanted; the example never installs or authenticates it:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.0.2
pi --version
pi
```

Use Pi's `/login` interactively, or provide the chosen provider's environment credentials to the
server process. See [Pi authentication](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/providers.md).
Do not put credentials in JSON configuration, argv, chat messages, or frontend storage.
The subprocess inherits the server environment; authentication stays with Pi on the server.

Edit `config.local.json`: set `mode` to `pi`; set `pi.command` to an installed executable path;
retain the supplied restriction flags. Configure `pi.cwd` as a dedicated working directory.
Paths resolve relative to the configuration file. The exact version is checked before the server
opens. An unavailable or mismatched executable, missing configured model availability, or malformed
catalog fails startup. See [CLI flags](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/cli.md).

## Provider, model and API-key setup (13.6.0)

The previous offline-only preview exposed one fixture and required out-of-band authentication.
Install the optional helper separately, with lifecycle scripts disabled:

```sh
npm ci --prefix examples/pi-observatory/sdk --ignore-scripts
```

Select **Pi · live provider**, Provider and Model, then enter a key in the masked field and press
**Save key & connect**. Keys clear from the input after submission. Connection mode/selection
persist on the server independently of credentials; browser local storage holds only non-secret
provider/model preferences. **Refresh providers** retries after helper installation or a setup
failure. Failed saved connections open offline, and explicit offline selection survives restart.
Existing external configured RPC still works without the optional helper.

The isolated helper pins Pi SDK **1.0.0**, released 2026-10-01 and eligible for the two-day gate.
The relevant auth/model/RPC contracts are identical to researched 1.0.2, whose Oct4 release is
not admitted by that gate. Root runtime dependencies remain unchanged; the nested lockfile owns
all optional SDK dependencies and no lifecycle/build scripts are enabled.
[1.0.0 source](https://github.com/earendil-works/pi/tree/a13d35a742c6ef8462812a28fbe1d8c8b7431c32),
[comparison](https://github.com/earendil-works/pi/compare/a13d35a742c6ef8462812a28fbe1d8c8b7431c32...200387122ca450d6387f033949423114a270b96c).

Pi RPC/CLI cannot write keys through stdin or discover the initial full catalog. The SDK's public
`ModelRuntime.create({allowModelNetwork:false,refreshOnCreate:false})`, `getProviders()` and
`getModels()` discover native/configured models before authentication. Only provider id/name,
API-key capability, stored-entry status and model provider/id/name reach the browser; headers,
endpoints and raw credential objects are withheld. Availability is not entitlement or live
credential validation. Native `listCredentials()` enumerates metadata without resolving secrets.
[Runtime API](https://github.com/earendil-works/pi/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/coding-agent/src/core/model-runtime.ts).

The helper receives bounded JSON on stdin and saves via native `login(provider,"api_key",interaction)`.
Only a single secret prompt is supported; multi-prompt/ambient/OAuth providers use a separate
Pi login flow. Pi owns lock/merge/permissions and preserves other providers. The configured agent
directory is passed to both helper and bundled RPC through `PI_CODING_AGENT_DIR`, so authentication
and catalog agree. Existing global Pi files are untouched. Native new directories/files use
0700/0600; unsafe existing modes/symlinks are refused. This is plaintext private file storage,
not encryption/keychain storage. The loopback app remains single-user, without tenant isolation.
[Native storage](https://github.com/earendil-works/pi/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/coding-agent/src/core/auth-storage.ts).

Pi key values can be configuration expressions. This form treats keys as literal data and refuses
leading `!`, dollar expressions, control/newline characters and oversized values before persistence.
It never executes submitted key text. Settings POST requires exact Origin and a per-process token;
setup and chat are serialized while idle. Save/activation errors do not become canonical run events.
A committed key whose synchronization/activation fails is reported as saved but not connected.
[Expression semantics](https://github.com/earendil-works/pi/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/coding-agent/src/core/resolve-config-value.ts).

Each fresh RPC invocation selects the exact catalog provider/model and awaits its acknowledgement
before prompting. Switching dropdowns or saving a key makes no model-generation request.
Selected identity remains retained in task input/provider evidence. Real credential validity,
billing and model access require a separately authorized actual provider call.

## Local Ollama and canvas controls

The supplied `connection.localProviders` declaration adds **Ollama** using its loopback tags
catalog and OpenAI-compatible `/v1` endpoint. Install the optional SDK, start Ollama with a
completion model already installed, select Pi → Ollama → Model, and **Connect local model**.
No API key is needed for the local server. **Refresh providers** discovers new installed models.
The example does not download models or make generation calls during discovery or connection.
Cloud-tagged entries are labeled; they may require Ollama cloud authentication/usage.

The helper queries configured `/api/tags`, and `/api/show` when optional capabilities are absent,
within a shared configured deadline and response/model bounds. Embedding-only models are omitted.
It writes only the configured local provider entries in its private `models.json`, preserving
unrelated custom providers; failed discovery removes stale owned entries. This custom catalog is
loaded by the same native Pi runtime and RPC process. Conservative text-only context/output
limits, compatibility flags, endpoints and placeholder auth value live in configuration; catalog
discovery does not prove a model's reasoning, vision, actual context size, entitlement or billing.
Primary sources: [tags](https://docs.ollama.com/api/tags), [show](https://docs.ollama.com/api/show),
[OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

Click the canvas or Tab to it, then use **arrow keys** to pan by `display.panStepPixels`.
Arrow panning turns off Live follow so incoming nodes cannot move the camera back.
Typing/navigation in chat fields and settings keeps its normal behavior; node Enter/Space selection
still works. Drag, zoom and Fit remain available.

**Clear canvas / new trace** starts an empty conversation and canvas while idle. It resets graph
selection, filters, playback and highlights; it preserves provider/model/key settings. The server
creates an adjacent uniquely named SQLite file and atomically writes a private filename pointer
(`traceSelectionFile`) beside the original configured database. Restart reopens that selected file.
The previous database is never truncated or deleted. Export first for convenient archive recovery.
To inspect an older database, stop the server and use a separate configuration pointing at that
file with a different unused `traceSelectionFile`; retain the files and original pointer. Missing
selected databases and unsafe pointer files fail closed. Each new trace has its own run capacity.

## Architecture and ownership

```text
Browser chat -> POST /api/chat -> validated Shepherd task
                                    -> executeTaskDurably + one ModelProvider invocation
                                       -> offline fixture OR fresh Pi RPC process
                                       -> canonical lifecycle, usage, outcome, terminal cut
Pi event types -> example observation owner -> canonical observation records
GET /api/state -> readDurableTaskExecution + retained owner reads -> disposable graph
GET /api/export -> SQLiteTraceStore.exportTrace -> native archive
```

The server uses only public `./tasks`, `./runs` and `./trace` package entries. Shepherd owns task
identity, validated input/output, durable start/terminal evidence and its one-invocation budget.
Pi owns the model loop. `maxTurns: 1` means one Pi invocation, not one Pi internal model turn;
Pi may retry internally. A fresh process receives a bounded transcript for each user turn;
`--no-session` prevents Pi session persistence. This intentionally gives no checkpoint, token-cache,
steering, fork, rewind, replay, or resumed Pi-process guarantee.

The app is dependency-free ESM JavaScript because it is an independently runnable browser example;
its HTTP tests run inside ordinary repository verification. The core remains TypeScript.
Files: `config.mjs` validates trusted configuration; `pi.mjs` owns the process/RPC boundary;
`server.mjs` owns task orchestration and read-only projections; `public/` owns rendering;
`test/` exercises actual HTTP and subprocess transport.

## RPC contract

The pinned [RPC reference](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/rpc.md)
documents newline-delimited requests and events. The adapter subscribes before writing one prompt.
After model selection, a successful matching prompt `response` acknowledges acceptance only. It waits for `agent_settled`,
not `agent_end`, which can precede retries or compaction. `message_end.message` supplies authoritative
assistant text and measured usage. Text deltas are advisory browser previews, discarded when the
retained terminal response replaces them. Unknown event types are observed but do not gain authority.

The [wire event reference](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/json.md)
has delta-only `message_update.assistantMessageEvent`; `text_delta.delta` supplies text. The parser
uses `StringDecoder` and splits only LF, accepting CRLF whitespace. It preserves split UTF-8 and
U+2028/U+2029 inside JSON strings. Do not substitute Node `readline`, which treats those Unicode
characters as line separators. Lines, event counts and replies are bounded; malformed output fails
the invocation. Missing token usage fails closed rather than inventing zero consumption. Unavailable
cost remains `null`; configured offline cost is synthetic. Stderr is discarded to prevent credential
or provider diagnostics leaking into HTTP or retained failure messages.

Stop sends `clear_queue` then `abort`, closes stdin, and waits for the actual child `close` event.
A configured kill deadline reaps an uncooperative direct child. Normal completion also closes stdin;
only a clean exit after settlement is success. Timeout, process failure, unsupported settlement,
malformed data or prompt refusal yields durable failure without retry. Unsupported extension dialogs
receive cancelled responses. See [RPC commands](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/rpc-commands.md)
and [extension UI protocol](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/coding-agent/docs/rpc-extension-ui.md).

## Graph semantics

| Display | Evidence / interpretation |
| --- | --- |
| Shepherd node | Exact content-addressed record ID, schema, mode, owner ordinal, witness and body. |
| RPC node | Example-owned observation of event **type and sequence**, not the raw Pi payload or a governed effect. |
| Arrow | `envelope.caused_by_record_ids`; no synthetic arrow from adjacency, timestamps or layout. |
| RPC parent | Invocation start record that enabled observation; observations do not claim causal dependence on preceding RPC events. |
| Parent outside view | Explicitly counted after filtering; inspector retains the complete parent IDs. |
| Owner ordinal | Owner-local order; cannot order unrelated owners globally. |
| Terminal cut | Immutable Shepherd execution prefix; separate RPC-owner observations are not inside that cut. |
| Partial reply | Transient Pi streaming preview, not canonical evidence. |

Canonical bodies have no timestamps. Browser poll times are not semantic time. Filtering and layout
are disposable projections; the inspector/export remain authoritative. GET routes neither append
nor repair. Test evidence checks archive bytes before/after repeated reads and after restart.

AppGraph-inspired interaction choices include a dark dotted canvas, typed compact cards, directional
edges, graph controls and evidence inspection. Primary UX sources: [canvas](https://github.com/hi77x/appgraph/blob/71de889c8b7f361be5d9eeee9011096b404d3f91/src/components/canvas/GraphCanvas.tsx),
[node](https://github.com/hi77x/appgraph/blob/71de889c8b7f361be5d9eeee9011096b404d3f91/src/components/canvas/GraphNodeView.tsx),
[inspector](https://github.com/hi77x/appgraph/blob/71de889c8b7f361be5d9eeee9011096b404d3f91/src/components/inspector/Inspector.tsx).
This is fresh SVG/DOM code, not copied AppGraph source. AppGraph's static architecture taxonomy,
confidence scores, ELK layout, React Flow and minimap are not implemented here. Its
[MIT license](https://github.com/hi77x/appgraph/blob/71de889c8b7f361be5d9eeee9011096b404d3f91/LICENSE)
requires preserving its copyright notice if substantial source is copied in a later change.

## Animated runtime flow

Live follow highlights newly observed committed records and animates their incoming canonical
arrows with dashed motion. The camera follows the latest browser observation when enabled;
uncheck Live follow to inspect a fixed position. Existing history on initial load is not labeled
as a new live event. Highlights expire after configured observation time, independent of trace
identity. Polling can observe several commits together; it is not a real-time timestamp oracle.

Play trace steps through the filtered graph in parent-before-child dependency order, highlighting
the current node, incoming arrows and inspector evidence. Stop playback interrupts only the
visualization. This is a causal traversal of retained evidence, not a replayed provider execution
or a historical total runtime order. No synthetic sequence edge is added. Missing parents remain
outside-view IDs. Reduced-motion preferences disable dashed movement while retaining highlights.
`display` config owns highlight lifetime, edge-animation duration, playback cadence and schema-label
prefix. `public/graph.mjs` and `test/graph.test.mjs` test traversal and live-observation expiry.

## Configuration and HTTP contract

`config.json` is the complete closed schema example. `limits` controls messages/requests, transcript
length, run capacity, RPC line/event/reply bounds, process and shutdown deadlines, and polling.
`budget` controls Shepherd's invocation count and total duration. `task`, `provider`, run-prefix,
observation schema/owner suffix and offline behavior are config-owned. Browser HTTP never accepts executable, arguments or filesystem paths. Settings accepts only
exact discovered model IDs and a bounded key submitted to native server-side storage.

| Route | Result |
| --- | --- |
| `GET /` | Static browser app; same-origin CSP, no external resources. |
| `GET /api/state` | Retained messages, run status/usage/cuts, graph nodes/parents and current preview. |
| `POST /api/chat` | `{text}` or configured `{itemId}`, with optional exact catalog `model`; 202 plus exact run ID; 400 invalid/oversized text, 409 concurrent/capacity refusal. |
| `POST /api/cancel` | Exact `{runId}`; 202 cancellation request, 409 stale identity. |
| `POST /api/connection` | Same-origin token and idle-only native setup, refresh, or offline selection; no model generation. |
| `POST /api/new-trace` | Same-origin token, empty object, idle-only adjacent database rotation; previous evidence retained. |
| `GET /api/export` | Full native trace archive; includes retained prompts/replies. |

POST requires `application/json`; oversized bodies return 413, wrong content type 415. Host and
Origin must match the bound IPv4 loopback origin; cross-site writes and DNS-rebinding hosts are
refused. This is a single-user local example, without authentication or multi-tenant isolation. Other local OS users can reach the loopback
listener; run on a trusted single-user host with disposable content.
Use a dedicated database and one server process. At `maxRuns`, export the evidence and configure
**Clear canvas / new trace** rather than deleting records. Historical run discovery is bounded and sorts its
example-generated identities for conversation display; canonical graph order remains owner-local.

## Recovery and safety boundary

On startup, committed runs reconstruct replies without invoking Pi. An interrupted run displays its
retained recovery classification, never automatically re-runs its provider. A trace-append failure
locks further writes until restart and evidence inspection. Use Shepherd's explicit recovery APIs
from a separately authorized operator path if recovery is necessary; the browser offers none.
Hard-killing the example can orphan a Pi child; terminate that exact child before restarting. The
example has no process-group containment or guarantee about arbitrary executable descendants.

The default flags disable tools, extensions, skills, prompt templates, context files and approval
configuration. They are **not an OS sandbox**. Pi otherwise has the launching user's process rights.
See [Pi permissions](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/README.md).
Changing argv or enabling tools is trusted operator configuration and can create host side effects.
Pi tool events would remain observations, bypassing Shepherd's typed effect admission. This example
does not deliver roadmap #264, #253 or #251. To govern tools, design a Pi extension/MCP bridge that
routes every tool call through Shepherd's actual supervised effect seam before execution, with
idempotent tool IDs, explicit outcome correlation, grants and crash reconciliation.

Prompts and replies are intentionally retained plaintext and visible to the local browser/export.
Use disposable test content, owner-protected storage, and inspect archives before sharing.
The full-window workspace uses the available height for the canvas and a bounded details panel.
The panel explains each record type and reports the selected run's actual provider, task identity,
budget, retained usage and cut. These views derive values from canonical evidence; configuration
owns explanatory text. No chat text is injected as HTML: DOM `textContent` and SVG text nodes render provider output.
No provider credentials are sent to the browser; diagnostic output is sanitized. Configured external Pi settings/auth files remain Pi-owned; the optional helper uses the dedicated private directory described above.

## Verification and extension guide

```sh
node --test examples/pi-observatory/test/http.test.mjs examples/pi-observatory/test/graph.test.mjs
pnpm verify
pnpm sync:version
pnpm build:desktop
```

Tests exercise real HTTP and real fixture child processes, not an in-memory transport mock.
Coverage includes durable graph identities/parents, read-only archive bytes, reopen, concurrency,
origin refusal, final text, UTF-8 splitting, CRLF, Unicode separators, unknown events, agent-end
versus settlement, invalid/oversized output, prompt/model-selection refusal, credential-header catalog redaction,
exact model provenance, shutdown, exit and cancellation cleanup.
The root `test/examples/pi-observatory.test.ts` runs the HTTP and graph fixture suites in ordinary verification.
The repository's 100% configured coverage applies to its configured core/tooling files, not the
browser or example JavaScript. Browser behavior requires the repeatable manual smoke below.

1. Start offline with a new configured database. Send a message and a follow-up; verify both replies.
2. Observe nodes appear while running; select lifecycle and RPC nodes and inspect exact parents.
3. Filter run/source, search schema/event/ID; use zoom, Fit and drag; verify no invented arrows.
4. Send literal HTML-like text; verify it renders as text, then resize to a narrow viewport.
5. Increase fixture delay in config, restart, send and Stop; verify cancelled status and new-turn readiness.
6. Export; restart on the same database; confirm retained history and identical archive when no turn ran.
7. For live validation, separately configure Pi + credentials, send a short prompt, Stop a second turn,
   check measured usage and process closure; record runtime, executable version and provider/model,
   without credentials. A fixture pass is not proof of a credentialed provider call.

Live credentialed Pi/provider execution, Windows/Linux UI/process behavior, automatic retries of
uncertain invocations, tool governance, durable provider checkpoints and production hosting remain
unverified or outside this example. Extend only against a concrete new contract and corresponding
HTTP/process tests. For larger graphs, replace the display layout while preserving record identities,
explicit parent edges, external anchors and authority boundaries. For remote hosting, add explicit
user authentication/authorization, request-level budgets, tenant storage and an actual process jail.

## Recorded local evidence (2026-10-04, initial 13.4.0 release)

Node 24.17.0 / macOS arm64: full `pnpm verify` exit 0 (1,378 passed, two intentional skips,
zero failures, 100% configured core/tooling coverage), version synchronization and production build
passed. Both source and freshly installed example suites passed all 18 tests. Browser smoke
verified playground, cancellation, literal text, filtering/inspector context, playback/live-follow,
responsive layout and provider/model selection against a clearly labeled RPC fixture. Initial
nested-test context failure was reproduced and fixed; the final wrapper requires tests actually run.
The internal standards/spec reviews have no unresolved blockers. No credentialed Pi/model,
Windows/Linux browser or independent billing evidence is claimed.

The 13.6.0 native setup suite uses only isolated dummy keys. It proves pre-auth discovery,
locked private save/reopen with sibling providers preserved, expression refusal, HTTP CSRF/identity
admission, trace/export byte preservation, connection restart and offline recovery. Run it after
installing the optional SDK:

```sh
node --test examples/pi-observatory/test/connection.test.mjs
```

Ordinary example conformance remains runnable without the helper. The root test wrapper also runs
native setup conformance when the optional SDK is installed, and diagnoses its absence explicitly.
No real credentialed generation is inferred from dummy-key tests.


Final 13.6.0 local evidence: Node24.17.0/macOS arm64 `pnpm verify` passed (1,402 passed,
two intentional skips, zero failures, 100% configured coverage); synchronization and production
build passed. The focused example suite passed24 tests including native SDK and Ollama discovery.
Browser smoke measured48px arrow panning, ordinary textarea arrow behavior, clear→zero chat/nodes,
reset inspector, live-follow disengagement, and an external RPC fixture model retained alongside
the installed SDK catalog. A real already-installed local `qwen2.5-coder:0.5b` turn through Pi1.0.0
finished with `OK`, 567 input/1 output tokens and23 retained records in an isolated test database.
No cloud-tagged generation or model download was used, and no real user credential was inspected.
