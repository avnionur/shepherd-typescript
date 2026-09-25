# Tool-Use Loop and Meta-Agent Tools

Status: normative from 6.0.0 (issue [#206](https://github.com/avnionur/shepherd-typescript/issues/206),
epic [#202](https://github.com/avnionur/shepherd-typescript/issues/202); paper Figure 1, §3.2,
Appendix A.2, Appendix F.2.3). Configuration: `providers.tools` and each live kind's `toolUse` in
[`protocol.config.json`](../protocol.config.json), read by
[`src/protocol/config-providers.ts`](../src/protocol/config-providers.ts) and locked by
`PROVIDER_PROTOCOL_V3_CONTRACT`. Implementation:
[`src/agent/tool-loop.ts`](../src/agent/tool-loop.ts),
[`src/agent/bindings.ts`](../src/agent/bindings.ts),
[`src/agent/meta-agent-tools.ts`](../src/agent/meta-agent-tools.ts), and
[`src/agent/types.ts`](../src/agent/types.ts); provider support in
[`src/provider/messages.ts`](../src/provider/messages.ts),
[`src/provider/live-dialects.ts`](../src/provider/live-dialects.ts), and
[`src/provider/program-provider.ts`](../src/provider/program-provider.ts). Public entry points: the
root and `./applications` ([`src/facades/applications.ts`](../src/facades/applications.ts)); the
program conversation provider and tool message types are also on `./providers`, which stays free of
`node:child_process` and `node:sqlite`. Tests:
[`tool-loop.test.ts`](../test/agent/tool-loop.test.ts),
[`tool-loop-boundaries.test.ts`](../test/agent/tool-loop-boundaries.test.ts),
[`meta-agent-tools.test.ts`](../test/agent/meta-agent-tools.test.ts),
[`meta-agent-figure1.test.ts`](../test/agent/meta-agent-figure1.test.ts), and
[`tool-dialects.test.ts`](../test/provider/tool-dialects.test.ts). Wire mapping:
[live providers](./live-providers.md#tool-wire-mapping).

## Loop

`runToolLoop(options)` runs one bounded multi-turn conversation:

| Option | Meaning |
| --- | --- |
| `loopId` | Stable identity; every tool-call effect identity derives from it |
| `messages` | Initial conversation; the first message is a user message |
| `tools` | `ToolLoopTool { name, description, inputSchema, effectKind, reversibility }` |
| `model` | `{ converse }`, for example any `ConversationalModelProvider` |
| `effects` | `{ dispatch(intent, signal) }`, see [effect boundaries](#effect-boundaries) |
| `maxTurns` | Turn bound; default `providers.tools.loop.defaultMaxTurns`, at most `maxTurns` |
| `outputSchema`, `system` | Final-turn output schema and stable system prompt |
| `guidance` | Hook consulted between turns; returned text joins the next user message |
| `onTurn` | Observer invoked once per completed turn, in order |
| `signal` | Cancellation, checked before and after every model call and between turns |

Each turn sends the whole conversation, the tool definitions, the output schema, and the system
prompt as one `ModelConversationRequest` whose cacheable prefix is the whole conversation. A
response without `tool_use` blocks ends the loop with status `completed` and the response output.
Otherwise the loop resolves every tool call in request order, appends one user message holding
exactly one `tool_result` block per call followed by the optional guidance text, and continues.
After `maxTurns` turns that all requested tools, the loop ends with status `turn_limit` and a null
output. Statuses and dispositions are configured (`TOOL_LOOP_STATUSES`, `TOOL_CALL_DISPOSITIONS`).

The result carries the full conversation, the output, the status, and every `ToolLoopTurn`
`{ index, request, response, calls, guidance }`. Guidance and observers make the loop reusable by a
concurrent supervisor: a supervisor can inject cited context between turns, observe each turn, and
abort the loop through its signal.

## Tool calls as effects

Each tool call resolves to exactly one disposition:

| Disposition | When | Intent | Outcome |
| --- | --- | --- | --- |
| `invalid` | The tool is not offered, or its input fails the tool's JSON Schema | None | None |
| `materialized` | The boundary dispatched the intent through a handler | Yes | Correlated outcome (success or world failure) |
| `denied` | An interceptor, the approval frontier, or replay policy refused it | Yes | None |
| `failed` | The handler threw or the dispatch was retained as `materialization_failed` | Yes | None |

Input schemas are compiled with [`compileJSONSchema`](./json-schema-validation.md) when the loop
starts, so an unsupported schema keyword refuses the loop before any turn. An admissible call
becomes the intent

```text
effect_id     <providers.tools.loop.effectIdPrefix><loopId>:<turn>:<call>
kind          the tool's effectKind
payload       { input, tool, tool_use_id }
reversibility the tool's reversibility tier
```

Effect identities are runtime-derived from the loop identity and position, never from the
provider's call identity, so a repeated loop issues the same intents. A materialized outcome must
correlate to the intent's identity and kind. The model receives the canonical JSON of
`{ disposition, result }`, `{ disposition, reason }`, or `{ disposition, issues }`, with `isError`
set for everything except a successful outcome, truncated at a character boundary to
`maxResultBytes` UTF-8 bytes followed by `truncationMarker`.

## Effect boundaries

| Factory | Dispatch | Evidence |
| --- | --- | --- |
| `createHandlerToolLoopEffects(stack)` | [Handler stack](./effect-handlers.md) directly; always `materialized`; handler errors propagate | None retained |
| `createSupervisedToolLoopEffects({ store, claimId, handlers, interceptors?, clock?, approvalTimeoutMilliseconds? })` | [`dispatchSupervisedEffect`](./supervised-effects.md) with command identity equal to the effect identity | Dispatch, decisions, approvals, admission, and resolution records per call |
| `createReplayToolLoopBindings(context)` | `context.dispatchEffect` inside a [replay session](./replay-sessions.md); the model boundary is `context.invokeProvider` | Provider and effect steps on the session owner path |

Under supervision a `denied` or `rejected` resolution yields `denied` with the deciding reason,
`materialization_failed` yields `failed`, and `cancelled` rethrows the loop signal's reason.

### Deny before outcome

Interceptors decide on the tool-call intent before admission. A denied call retains the dispatch
and decision records and a `denied` resolution without admission or outcome; the handler never
runs; the model receives a `denied` result and the loop continues. `tool-loop.test.ts` ("a denied
tool-call intent resolves before any outcome and the handler never runs") inspects both the denied
and an allowed dispatch in the same turn.

### Replayable loops

Inside a replay session each turn is one provider step whose request is the encoded turn
(`encodeToolTurnRequest`): instruction `providers.tools.turn.instruction`, input
`{ cache_prefix_messages, messages, output_schema, system, tools }`, and output schema
`providers.tools.turn.outputSchema`. The session provider is `createToolTurnProvider(model)`, which
decodes the turn, calls `converse`, and returns `{ message, output, stop_reason }` as the step output.
Each tool call is one effect step. Because every turn request is a pure function of retained data,
`replayReplaySession` serves the recorded prefix (model turns and tool outcomes) without invoking
the model or any handler, and the loop observes a byte-identical conversation. `tool-loop.test.ts`
("replaying a recorded loop serves its prefix byte-identically and runs only the suffix live")
compares step identities, prefix identities, canonical requests, outputs, and outcomes over the
prefix and the full transcripts, and shows a rewind copies the same steps. Changed guidance over the
prefix is a `ReplayPrefixMismatchError`. In a branch suffix, an irreversible tool call without
replay approval is `denied`. A successful call of a `compensable` tool is compensated once, in
reverse order, when a branch that abandons its source (source disposition `compensate`, the
default) rewinds or replays past it, and a supervised call when a discarded
scope cites its resolution ([effect compensation](./compensation.md));
[`tool-loop-compensation.test.ts`](../test/agent/tool-loop-compensation.test.ts) rewinds a loop
past two compensable calls.

## Scripted models

`createProgramConversationProvider({ id, model?, respond })` answers each turn with a caller
program and validates the reply; the test fixture
[`test/agent/fixtures.ts`](../test/agent/fixtures.ts) scripts meta-agent turns with it. Live kinds
map tools as described in [live providers](./live-providers.md#tool-wire-mapping).

## Meta-agent tool catalog

`providers.tools.metaAgent.tools` declares one tool per substrate operation, each with a name,
description, effect kind, reversibility tier, and input JSON Schema. The loader requires every
operation exactly once with distinct names and effect kinds. `createMetaAgentTools(environment)`
returns the catalog as `ToolLoopTool`s and one exact-kind handler per tool.

| Tool | Operation | Substrate API | Tier |
| --- | --- | --- | --- |
| `observe` | Summarize a replay session: mode, status, result, failure, checkpoints, origin, and at most `limits.maxObservedSteps` step summaries (effect kind, disposition, ok, value or error; provider output or failure) | `inspectReplaySession` | reversible |
| `fork` | Fork world custody (world adapter) or allocate a root, then run a declared worker session to its terminal record | `ApplicationWorldAdapter.fork` ([scope fork](./scope-fork.md)), `runReplaySession` | reversible |
| `discard` | Discard forked custody | `ApplicationWorldAdapter.discard` ([scope discard](./scope-merge-discard.md)) | irreversible |
| `rewind` | Restore a session's worlds into allocated empty roots at a checkpoint or step boundary | `rewindReplaySession` | reversible |
| `replay` | Replay a session under a declared worker variant; the source is retained | `replayReplaySession` with `sourceDisposition: "retain"` | reversible |
| `read_trace` | Read at most `limits.maxTraceRecords` records of one owner path from an ordinal | Exact-ordinal owner reads, the records a [trace subscription](./trace-subscriptions.md) delivers | reversible |
| `diff` | Align a branch with its source | `analyzeReplayDivergence` | reversible |

The environment supplies the store, the claim identity, an optional clock, the forkable workers by
name (`{ program, programId, world, compensation?, handlers?(root), provider?, task?, variants? }`), an optional
world adapter such as `createScopeWorldAdapter`, and `allocateRoot({ commandId, operation, world })`
returning an existing empty directory. Rewind and replay resolve the worker by the source session's
`program_id`. Rewind abandons the source's suffix and passes the worker's `compensation` registry to
the branch. Replay is exploratory: it keeps the source as a retained alternative
(`sourceDisposition: "retain"`, [source disposition](./compensation.md#source-disposition)), so it
never compensates and needs no registry; it applies the named variant's `changes`, `handlers`,
`provider`, `task`, and `policy`. Both tools are `reversible`: the branch they create is a new
session, and neither call leaves a world change of its own for a later rewind to compensate.

Each handler re-validates its input and derives the substrate command identity
`<commandIdPrefix><session_id>:<effect_id>` inside a replay-bound loop
(`createReplayToolLoopBindings`), where `session_id` is the session executing the call, and
`<commandIdPrefix><effect_id>` elsewhere. The loop's effect identities stay
`<effectIdPrefix><loopId>:<turn>:<call>`, so a replay of a meta session still serves its recorded
prefix byte-identically without invoking any handler, while every call the branch runs live issues
fresh `fork`, `discard`, `rewind`, and `replay` commands instead of converging on the source's
receipts. A repeated intent in the same session converges on retained receipts. Substrate refusals
are returned to the model as failure results `{ code, name, message }`.

### Paper proposer tool names

The CRO proposer surface of Appendix F.2.3 names `read_effect_trace`, `grep_effect_traces`,
`diff_traces`, `branch`, and `stage_variant`. Since 11.0.0 the
[counterfactual optimizer's provider-backed proposer](./counterfactual-optimization.md#proposers)
offers `inspect_candidates`, `read_effect_trace`, `grep_effect_traces`, and `propose_candidate`
(pinned in [`config/research-applications.config.json`](../config/research-applications.config.json)
and bound to the operations of `applications.cro.proposer.operations`). The remaining paper tools
map onto this catalog as follows:

| Paper tool | Equivalent | Notes |
| --- | --- | --- |
| `read_effect_trace` | CRO `read_effect_trace`; catalog `read_trace`, `observe` | Per-example step summaries, raw records, or a session summary |
| `grep_effect_traces` | CRO `grep_effect_traces` | Bounded regex search over one candidate's example step summaries |
| `diff_traces` | `diff` | Step-aligned divergence with causes |
| `branch` | `fork`, `rewind`, `replay` | Fork custody, restore a checkpoint, or replay from one |
| `stage_variant` | CRO `propose_candidate`; catalog `replay` with a declared variant | Edits are data applied by the caller's edit applier, not model-authored code |

## Figure 1 scenario

`meta-agent-figure1.test.ts` runs the Figure 1 loop end to end with real scopes and worlds: a
scripted meta-agent inside a replay session forks a coder worker into scope custody from
`createScopeWorldAdapter`; the worker checkpoints, writes an edit, and its check fails; the
meta-agent observes the failing check and reads the worker trace, rewinds to the clean checkpoint
(the restored file holds the original content), replays under a `careful` provider variant whose
check passes, diffs the branch (first divergence at step 0, nothing unexplained), and discards the
failed custody. Every tool call is a materialized effect step of the meta session, and the parent
world is unchanged. The same file rewinds the recorded meta session to step 0 (no compensation
handler is needed or invoked), replays it from step 0 with a new first call
`fork { worker: "coder", worker_id: "w2" }` (a new worker session and custody, not the source's),
and replays it from its last boundary (every prefix step recorded with the source's intent and
prompt identities, and no tool handler invoked).

## Limits

- No streaming, parallel tool-call execution, or tool-choice control; calls in one turn run
  sequentially in request order.
- The model is scripted in every test. No live provider ran a tool loop in this repository (no
  credentials), so live tool-calling behavior is covered only by the wire-mapping tests with stub
  transports.
- `read_trace` reads any owner path in the store: the meta-agent holds store-wide read authority.
- `fork` runs the worker to completion inside the tool call; a worker is not observed while it runs.
  Live observation of running workers, with `guidance` injected between their turns, is the
  [runtime supervisor](./runtime-supervisor.md) (11.1.0, #211), which runs every worker as a loop.
- A repeated `fork` or `rewind` intent re-allocates restoration roots before the substrate returns
  its retained receipt; the extra directories stay empty.
- Command identities are scoped to the executing session only inside a replay-bound loop. A
  materialization-uncertain meta call recovered by a new replay branch runs live under the branch's
  scope and therefore issues a new substrate command instead of converging on the interrupted one.
- Worker programs, handlers, and variants are caller code; a model can select but not author them.
