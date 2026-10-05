# Live Providers and Prompt-Cache Prefix Reuse

Status: normative from 5.1.0 (issue [#204](https://github.com/avnionur/shepherd-typescript/issues/204),
epic [#202](https://github.com/avnionur/shepherd-typescript/issues/202); paper §3.1, §4, Appendix
C.6, §5, Appendix D). Configuration: `providers` in [`protocol.config.json`](../protocol.config.json),
read by [`src/protocol/config-providers.ts`](../src/protocol/config-providers.ts) and locked by
`PROVIDER_PROTOCOL_V4_CONTRACT` (tool use added in 6.0.0, issue
[#206](https://github.com/avnionur/shepherd-typescript/issues/206); see
[tool-use loop](./tool-use-loop.md)). Implementation:
[`src/provider/live-provider.ts`](../src/provider/live-provider.ts),
[`src/provider/live-dialects.ts`](../src/provider/live-dialects.ts),
[`src/provider/messages.ts`](../src/provider/messages.ts),
[`src/provider/conversation.ts`](../src/provider/conversation.ts), and `LiveProviderError` in
[`src/provider/errors.ts`](../src/provider/errors.ts). Public entry points: the root and
`./providers` ([`src/facades/providers.ts`](../src/facades/providers.ts)). Tests:
[`test/provider/live-provider.test.ts`](../test/provider/live-provider.test.ts),
[`test/provider/provider-conversation.test.ts`](../test/provider/provider-conversation.test.ts),
[`test/provider/live-provider-secrets.test.ts`](../test/provider/live-provider-secrets.test.ts),
[`test/provider/protocol.test.ts`](../test/provider/protocol.test.ts),
[`test/provider/tool-dialects.test.ts`](../test/provider/tool-dialects.test.ts), and the opt-in
[`test/provider/live-provider-opt-in.test.ts`](../test/provider/live-provider-opt-in.test.ts).

## Provider kinds

`providers.kinds` is the closed provider-kind vocabulary: `static`, `program`, and every key of
`providers.live.kinds`, each exactly once. The shipped live kinds are `anthropic`, `openai`, and
`openrouter`. `PROVIDER_KINDS` and the `ProviderKind` type are generated from the configuration, and
the replay-session and run-ledger schemas enumerate the same kinds. Adding a kind that reuses an
implemented wire dialect is a configuration change followed by `pnpm generate:protocol`; it needs no
runtime code.

Each live kind configures:

| Field | Meaning |
| --- | --- |
| `dialect` | Implemented wire dialect: `anthropic_messages` or `openai_chat_completions` |
| `endpoint` | Default absolute endpoint; a caller may override it per instance |
| `headers` | Static lowercase request headers, such as the API version header |
| `credential` | Environment variable read when the caller supplies no credential, the header carrying it, and an optional scheme such as `Bearer` |
| `cacheControl` | Prompt-cache marker placed on the last content the last prefix message produces on the wire, or `null` for none |
| `maxOutputTokens`, `maxTokensField` | Default output-token limit and the body field that carries it |
| `outputFormat` | Structured-output name and strictness; required by the OpenAI-compatible dialect |
| `completeStopReasons` | Provider stop reasons accepted as a complete response |
| `toolUse` | `requestField` carrying tool definitions and the `stopReasons` of a complete turn that requests tool calls (disjoint from `completeStopReasons`) |
| `capabilities` | Declared descriptor capabilities (`streaming` is `false`; `tools` is `true`) |

Runtime code contains no endpoint, header name, API version, credential variable, model identity,
or cache-control shape; `runtime source contains no provider-specific literals` in
`live-provider.test.ts` scans `src/` (except the generated constants and the compatibility lock)
for every configured value. The dialect modules own only the field names of their wire formats.

## Live adapters

`createLiveProvider({ kind, id, model, credential?, environment?, endpoint?, maxOutputTokens?,
transport? })` returns a `ConversationalModelProvider`: a `ModelProvider` with an additional
`converse(request, signal)`. The descriptor carries the configured kind and capabilities, the
caller id, and the model; it never carries the credential.

- `invoke(request, signal)` renders the `ModelRequest` as one user message and calls `converse`
  with that message as the cacheable prefix. It returns `{ output, usage }`.
- `converse(request, signal)` accepts a `ModelConversationRequest`: ordered `messages` starting with
  a user message, `cachePrefixMessages` (how many leading messages form the reusable prefix, `0` for
  none), an `outputSchema` or `null`, a `system` prompt or `null`, and optional `tools`. It returns
  the assistant `message` as the provider sent it, the parsed `output`, the `stopReason`, and
  `usage`. When the stop reason is one of the kind's `toolUse.stopReasons`, the message carries its
  text and `tool_use` blocks in response order and `output` is `null`; such a response without a
  tool call, or a complete response that carries tool calls, is a `response` error.

### Tool wire mapping

Tools are sent only when the request offers at least one, under the kind's `toolUse.requestField`,
before `messages` so a request prefix stays a byte prefix. Requests without tools are byte-identical
to 5.1.0 requests.

| Provider-neutral | `anthropic_messages` | `openai_chat_completions` |
| --- | --- | --- |
| Tool definition `{ name, description, inputSchema }` | `{ name, description, input_schema }` | `{ type: "function", function: { name, description, parameters } }` |
| Assistant `tool_use` block `{ id, name, input }` | `{ type: "tool_use", id, name, input }` content block | `tool_calls[]` entry `{ id, type: "function", function: { name, arguments } }` with canonical-JSON arguments; text becomes `content` or `null` |
| User `tool_result` block `{ toolUseId, content, isError }` | `{ type: "tool_result", tool_use_id, content, is_error }` content block | One `{ role: "tool", tool_call_id, content }` message per result, then any text as a user message; the dialect has no error flag, so the error is carried in `content` |

Decoded tool inputs must be JSON objects that canonicalize; OpenAI `arguments` must parse as a JSON
object. The per-dialect wire names are fixed by each published API; the per-kind request field and
stop reasons are configured. The Anthropic tool-use block type and its stop reason are both
`tool_use`, so the source literal scan in `live-provider.test.ts` does not cover tool stop reasons.

The Anthropic Messages dialect sends the system prompt as one text block, the output schema as
`output_config.format` with type `json_schema`, and the configured `cacheControl`
(`{ "type": "ephemeral" }`) on the last content block of message `cachePrefixMessages - 1`. The
OpenAI-compatible dialect sends the system prompt as a `system` message and the schema as
`response_format.json_schema` with the configured name and strictness. With a `null` cache marker
(OpenAI, whose caching is automatic) message content is a string; with a marker (OpenRouter, which
forwards it to providers that need explicit breakpoints) text content is a list of text parts and
the marker goes on the last wire content message `cachePrefixMessages - 1` produces: its last text
part when it has text, otherwise (a user message holding only tool results) the last `tool` message,
whose content becomes one text part carrying the marker; earlier tool messages keep string content.
An assistant message with tool calls and no text has no content part to carry a marker, so a prefix
ending there is sent unmarked (a tool loop's prefix always ends with a user message);
`tool-dialects.test.ts` ("an openai-compatible cache marker lands on the last tool result of a
results-only prefix"). `messages` is always the last key of the body, so an unchanged message prefix is a
byte prefix of the serialized request.

A structured response is the concatenated text blocks (thinking blocks are ignored) parsed as JSON
and snapshotted as a canonical semantic value; a request with `outputSchema: null` returns the text.
The provider boundary does not validate the output against the schema; task execution and replay
consumers keep that responsibility.

### Usage normalization

| `ModelUsage` field | Anthropic Messages | OpenAI-compatible |
| --- | --- | --- |
| `inputTokens` | `usage.input_tokens` (uncached input) | `usage.prompt_tokens` minus cached tokens |
| `cacheReadInputTokens` | `usage.cache_read_input_tokens` | `usage.prompt_tokens_details.cached_tokens` |
| `cacheCreationInputTokens` | `usage.cache_creation_input_tokens` | `0` (not reported) |
| `outputTokens` | `usage.output_tokens` | `usage.completion_tokens` |
| `costUsd` | `null` | `null` |

Absent or `null` cache fields count as `0`. Cache tokens flow unchanged into
[run usage](./run-artifacts-and-usage.md) and into replay [cache evidence](./replay-sessions.md).
Cost is not reported, so a run with a `maxCostUsd` budget ends with the configured
cost-unavailable failure.

### Cancellation

Both operations reject with the signal's reason when it is already aborted (without calling the
transport), when it aborts while the transport is pending (even if the transport ignores the
signal), and when it aborts before a response is processed. The default transport passes the signal
to `fetch`.

### Errors and credentials

`LiveProviderError` carries a configured `code`, a `reason`, and an HTTP `status` for `http`
failures:

| Reason | Code | Raised when |
| --- | --- | --- |
| `credential` | `LIVE_PROVIDER_CREDENTIAL_MISSING` | No caller credential and the configured variable is unset or blank (at construction; the message names the variable) |
| `transport` | `LIVE_PROVIDER_TRANSPORT_FAILED` | The transport throws or returns a malformed response; the cause stays in memory only |
| `http` | `LIVE_PROVIDER_HTTP_FAILED` | A non-2xx status; the message appends the status and the provider error type and message |
| `response` | `LIVE_PROVIDER_RESPONSE_INVALID` | Non-JSON body, missing content or usage, an incomplete stop reason, empty text, or non-JSON structured output |

The credential comes only from `definition.credential` (caller configuration) or the configured
environment variable (`definition.environment`, default `process.env`), is read once, and is held
only in the provider closure. It is sent only in the configured credential header. Provider error
detail is bounded to `providers.live.limits.maxErrorDetailBytes` and every occurrence of the
credential is replaced with `providers.live.redaction` before a message is built, because failure
messages are retained in run outcomes and replay steps. `live-provider-secrets.test.ts` runs
provider-backed durable tasks (one success, one 401 whose body echoes the credential) and a replay
session with a rewind over a failing turn, then asserts that neither the exported trace, any
archived blob, nor any byte of the store's files contains the credential.

The adapters perform no retries; a caller wraps the transport for retry policy.

## Message model

`ModelMessage` is `{ role, content }` with configured roles (`MODEL_MESSAGE_ROLES`: `user`,
`assistant`) and a content list of `ModelContentBlock`. `MODEL_CONTENT_BLOCK_TYPES` is `text`,
`tool_use`, and `tool_result`: `ModelTextBlock { type, text }`, `ModelToolUseBlock
{ type, id, name, input }` (assistant messages only), and `ModelToolResultBlock
{ type, toolUseId, content, isError }` (user messages only). `ModelConversationRequest.tools` is an
optional list of `ModelToolDefinition { name, description, inputSchema }` with unique portable names
(`[a-zA-Z0-9_-]{1,64}`). A request without tools keeps its 5.1.0 shape and identity.

`createProgramConversationProvider({ id, model?, respond })` is a conversational provider of the
`program` kind whose turns are answered by a caller program; it declares
`providers.program.conversationCapabilities` and is the offline way to script tool-calling models.

A request renders as a user message whose text is the canonical JSON of
`{ input, instruction, output_schema }` (field names from `providers.messages.rendering`). An output
renders as an assistant message whose text is the canonical JSON of the output. Both are pure
functions of retained data, so equal requests and outputs render to equal bytes.

## Provider conversations and rewind

`createProviderConversation({ adapterId, provider, system?, checkpointStore?, configurationId? })` returns a `ProviderConversation`:

- `provider`: a `ModelProvider` whose `invoke` sends the held messages plus the rendered request
  with the whole list as the cacheable prefix, and after success appends the rendered request and
  the rendered output. Turns must be sequential.
- `session`: a `ReplayProviderSessionAdapter` for [replay sessions](./replay-sessions.md) and
  [coupled checkpoints](./coupled-checkpoints.md).
- `messages()` and `contextPrefixId()` expose the held state.
- `rebuild(steps)` rebuilds the held state from retained replay steps.

The conversation mirrors the session's chained context prefix identity, including failed
exchanges, which add no messages; a cancelled turn changes nothing. Its `checkpoint` retains the
held state under a content-derived `provider-conversation:` receipt and reports the held context
prefix identity, so the checkpoint classifies the provider session as verified only when the
identities agree. `restore(receiptId)` resets the held state to the receipt and returns its context
prefix identity, which the branch compares with the recorded one. `cacheIdentity` declares a
`provider-prefix:` digest of the held system prompt and messages when the session's prior context
prefix matches the held one.

After `rewindReplaySession` or `replayReplaySession` restores a checkpoint, the recorded prefix is
served from records without provider calls and the first live suffix request resends exactly the
checkpoint's message prefix. `provider-conversation.test.ts` proves with a stub transport that the
replayed request body is byte-identical to the original request at the same step, that a diverged
suffix request shares the serialized message prefix byte for byte, that the replayed step's cache
identity equals the original's, and that a simulated prefix cache reports read tokens (`hit`) with
no creation tokens on the replayed step. A conversation rebuilt from retained steps after a restart
produces the same bytes for a step-count target.

Without `checkpointStore`, receipts live in process memory; after restart use `rebuild` and a
reconstructive step-boundary replay. Opt into [retained conversation checkpoints](./provider-conversation-checkpoints.md)
for verified restoration across restart/native import, with explicit system-prompt retention and
provider/configuration validation before branch work.

## Live verification

`live-provider-opt-in.test.ts` runs a root session, a checkpoint, and a replay against a real
provider with a long stable system prompt, and asserts `hit` cache evidence with read tokens on the
replayed step. It runs only with `SHEPHERD_LIVE_PROVIDER_TEST=1`, `SHEPHERD_LIVE_PROVIDER_MODEL`,
optionally `SHEPHERD_LIVE_PROVIDER_KIND` (default: the first configured live kind), and the kind's
credential variable. No credentials were available when 5.1.0 was prepared, so the test was skipped
and no live cache-hit rate has been measured by this repository. The paper's prefix-cache reuse
figure is not reproduced here. Provider prompt caches also have a model-dependent minimum cacheable
prefix; shorter prefixes are not cached and report no read tokens.

## Limits

- No streaming (`capabilities.streaming` is `false`); no parallel-tool-call or tool-choice controls.
- No cost reporting; `costUsd` is `null`.
- No retry or rate-limit handling.
- The OpenAI-compatible dialect does not report cache creation tokens.
- Provider structured-output features impose schema restrictions (for example
  `additionalProperties: false`) that some task schemas may not meet; such a request fails with the
  provider's `http` error.
- Claude CLI and Codex process adapters are not provided.
