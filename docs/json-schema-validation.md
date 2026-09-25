# JSON Schema Validation

Implementation: [`src/schema/json-schema-validator.ts`](../src/schema/json-schema-validator.ts) and
[`src/schema/errors.ts`](../src/schema/errors.ts). Public entry points: the root
[`src/index.ts`](../src/index.ts) and `./tasks` ([`src/facades/tasks.ts`](../src/facades/tasks.ts)):
`compileJSONSchema`, `JSON_SCHEMA_SUPPORTED_KEYWORDS`, `JSONSchemaValidator`, `JSONSchemaDocument`,
`JSONSchemaIssue`, and `JSONSchemaValidationError`. Application wiring:
[`src/applications/protocol-schemas.ts`](../src/applications/protocol-schemas.ts). Tests:
[`test/schema/json-schema-validator.test.ts`](../test/schema/json-schema-validator.test.ts) and
[`test/applications/protocol-schemas.test.ts`](../test/applications/protocol-schemas.test.ts).

## Purpose

`compileJSONSchema(document)` compiles one JSON Schema 2020-12 document in a closed subset into a
reusable validator. It is the one runtime evaluator for documents that are data rather than
builder output: pinned application protocol schemas (Appendix E and F), and the input schemas of
every tool the [tool-use loop](./tool-use-loop.md) offers. Task input/output schemas keep their own builder language
([task descriptors](./task-descriptors.md)); their parse errors use the same
`JSONSchemaValidationError` and issue shape.

## Supported subset

`JSON_SCHEMA_SUPPORTED_KEYWORDS` is the complete list. Any other keyword is refused at compile time
with a `TypeError`, never ignored.

| Group | Keywords | Semantics |
| --- | --- | --- |
| Annotations | `$schema`, `$comment`, `title`, `description` | `$schema` only at the root and only equal to `kernel.schemas.dialect`; the others must be strings |
| Type | `type` | One name or a non-empty distinct array of `array`, `boolean`, `integer`, `null`, `number`, `object`, `string`; `integer` is any number with a zero fractional part |
| Values | `enum`, `const` | Compared as canonical JSON, so object key order never matters |
| Numbers | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` | Finite numbers; checked only when the value is a number |
| Strings | `minLength`, `maxLength`, `pattern` | Lengths count Unicode code points; `pattern` is an ECMAScript expression with the `u` flag |
| Arrays | `items`, `minItems`, `maxItems`, `uniqueItems` | `items` is one schema for every element; uniqueness compares canonical JSON |
| Objects | `properties`, `required`, `additionalProperties` | `additionalProperties` is a boolean or a schema |
| Combinators | `allOf`, `anyOf`, `oneOf` | Non-empty schema lists; `oneOf` requires exactly one match |

Boolean schemas `true` and `false` are accepted anywhere a schema is. `$ref`, `$defs`, `not`,
`if`/`then`/`else`, `format`, `patternProperties`, `prefixItems`, `multipleOf`, dependent keywords,
and unevaluated keywords are not supported.

`pattern` values are compiled with `new RegExp(value, "u")` without any complexity or backtracking
bound, so a pathological expression can be slow to evaluate; protocol and schema documents must come
from trusted configuration, never from untrusted input. Tool `inputSchema` documents are in the same
trust class: the caller's `ToolLoopTool` definitions
([`src/agent/tool-loop.ts`](../src/agent/tool-loop.ts)) are trusted caller code, and the meta-agent
tool schemas ([`src/agent/meta-agent-tools.ts`](../src/agent/meta-agent-tools.ts)) come from
`providers.tools.metaAgent` in `protocol.config.json`. Both are compiled once when the loop or the
meta-agent tool set is created. Model-produced tool arguments are untrusted values validated
against those schemas; a model never supplies a schema or a `pattern`.

## Validation

`validate(value)` first requires canonical JSON data: plain objects, dense arrays, finite numbers,
well-formed strings, booleans, and null, without accessors, symbols, or cycles. Otherwise it returns
one `json` issue at `$`. Accessors are never invoked. A value nested deeper than
`kernel.canonicalization.maxNestingDepth` raises `CanonicalNestingLimitError`, like every canonical
input. It then returns every issue in document order; an empty list means valid.

`parse(value, subject?)` returns the deeply frozen canonical snapshot of a valid value, or throws
`JSONSchemaValidationError`.

Each `JSONSchemaIssue` is `{ path, keyword, message, schemaPath }`:

- `path` is rooted at `$`, with `.name` for identifier keys, `["name"]` otherwise, and `[index]`;
- `keyword` is the refusing keyword (`json` for non-canonical input, `false` for a false schema);
- `schemaPath` is the JSON Pointer fragment of that keyword in the document, rooted at `#`.

A missing required property is reported at the property's path. When no `anyOf` or `oneOf` member
matches, the summary issue is followed by every member's issues; an ambiguous `oneOf` lists the
matching member indices.

`JSONSchemaValidationError` is a `TypeError` with the configured public code
`SCHEMA_VALIDATION_FAILED` (`public-errors.config.json`, `schemas.validation`) and a frozen `issues`
list. Its message is `[subject: ]<path> <message>` joined with `; ` and never embeds the refused
value.

## Application protocols

`readApplicationProtocol` compiles every `schema` surface, so a protocol whose schema surface is
outside the supported subset is `ApplicationProtocolError` before any record. The applications then
validate their protocol messages against every `schema` surface of the configured role:

| Application | Role | Message | Refusal |
| --- | --- | --- | --- |
| [Coding supervisor](./coding-supervisor.md#protocol) | `observation` | `{ conflict, round, workers: [{ changed_paths, completion_status, status, worker_id }] }` before the policy is consulted | `ApplicationProtocolError` (cause: the validation error); nothing retained for the round |
| Coding supervisor | `action` | `{ kind, reason, worker_id }` projected from the policy decision, null where the kind carries no field | `JSONSchemaValidationError`; the decision is never applied |
| [Runtime supervisor](./runtime-supervisor.md#ticks-and-snapshots) | `observation` | The per-tick snapshot `{ tick, agents }` before the policy is consulted | `ApplicationProtocolError`; running workers are aborted and the tick is not retained |
| [Runtime supervisor](./runtime-supervisor.md#decisions) | `action` | The Appendix E `{ decisions: [{ agent, action, reason, guidance?, leader? }] }` output, also the output schema of the provider-backed policy | The whole batch is refused and retained with its issues; no decision is applied |
| [Trajectory compression](./trajectory-compression.md#protocol) | `compression` | The compressor's `{ fork_point, hint }` proposal | The candidate is retained as rejected; `ApplicationEvidenceError` with the validation error as cause |
| [Counterfactual optimization](./counterfactual-optimization.md#admission-and-the-reflection-contract) | `reflection` | Every proposer attempt's reflection, before any evaluation | The attempt is refused with the validation message and retried; exhausted attempts are `ApplicationVerificationError` |
| [Counterfactual optimization](./counterfactual-optimization.md#manifest-handoff-and-computation-reuse) | `handoff` | `{ candidates: [{ candidate_id, parent_candidate_id, status }], selected_candidate_id }`, returned as `receipt.handoff` | `ApplicationProtocolError` before the manifest is retained |
| [Tree-RL](./tree-rl-rollouts.md#protocol) | `training_batch` | Every `jsonl_v2` line, baseline lines included | `ApplicationProtocolError` before the batch record is retained |
| [Tree-RL](./tree-rl-rollouts.md#fork-selection) | `fork_proposal` | The meta-agent selector's `{ branch_turn, tool_call, reason }` proposal | `ApplicationVerificationError` from the selector; the root records before it stay retained |

The [tool-use loop](./tool-use-loop.md) compiles the input schema of every tool it offers and
validates each call before an intent exists (6.0.0,
[#206](https://github.com/avnionur/shepherd-typescript/issues/206)); since 11.0.0 the CRO
provider-backed proposer offers the pinned `proposer` tool surfaces this way
([#212](https://github.com/avnionur/shepherd-typescript/issues/212)), and the round-based coding
supervisor's pinned tool surfaces are not offered to a model. The runtime supervisor's
provider-backed policy sends the `action` schema as a JSON-mode output schema instead of tools
(11.1.0, [#211](https://github.com/avnionur/shepherd-typescript/issues/211)).

## Differential evidence

The validator test compares validity with an independent JSON Schema 2020-12 implementation (Ajv,
a development dependency only) for every pinned repository schema and tool input schema over a
shared sample set.
