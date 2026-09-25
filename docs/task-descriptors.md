# Task Descriptors

Implementation:
[`src/task/descriptor.ts`](../src/task/descriptor.ts),
[`src/task/schema.ts`](../src/task/schema.ts), and
[`src/task/types.ts`](../src/task/types.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/task/descriptor.test.ts`](../test/task/descriptor.test.ts),
[`test/task/schema-builders.test.ts`](../test/task/schema-builders.test.ts), and
[`test/task/schema-contract.test.ts`](../test/task/schema-contract.test.ts).

## Bodyless task contract

`task()` creates an immutable, versioned descriptor from a logical name, caller-selected version,
behavioral instruction, input schema, and output schema. The instruction is executable behavior,
not an inert comment: changing it changes the task artifact digest.

```ts
const writeNote = task({
    name: "writeNote",
    version: "1.0.0",
    instruction: "Write one note about the topic.",
    input: schema.object({ topic: schema.string() }),
    output: schema.void(),
});
```

## Schema forms

The schema factory emits exactly these JSON Schema 2020-12 documents; this closed set is the task
schema language:

| Builder | Document | Inferred type | Accepts |
| --- | --- | --- | --- |
| `schema.string()` | `{ type: "string" }` | `string` | Well-formed strings |
| `schema.number()` | `{ type: "number" }` | `number` | Finite numbers |
| `schema.integer()` | `{ type: "integer" }` | `number` | Safe integers (`Number.isSafeInteger`) |
| `schema.boolean()` | `{ type: "boolean" }` | `boolean` | `true` or `false` |
| `schema.null()` | `{ type: "null" }` | `null` | JSON `null` only |
| `schema.void()` | `{ type: "null" }` | `void` | `undefined` or `null`, resolved to `undefined` |
| `schema.array(items)` | `{ type: "array", items }` | `readonly T[]` | Dense plain arrays; each element satisfies `items` |
| `schema.enum([a, b])` | `{ enum: [a, b] }` | `a \| b` | One listed scalar (string, finite number, boolean, or null) |
| `schema.literal(a)` | `{ const: a }` | `a` | Exactly the scalar |
| `schema.union([A, B])` | `{ oneOf: [A, B] }` | `A \| B` | A value satisfying exactly one member |
| `schema.object(shape)` | strict object, below | readonly object | Plain objects with declared fields |
| `schema.task()` | `{ $ref: <task value schema id> }` | `TaskValue` | Canonical task values ([task values](./task-values.md)) |

`schema.object()` emits `type: "object"`, `additionalProperties: false`, `properties`, and a
sorted `required` array. A field is required unless wrapped in `schema.optional(schema)`: an
optional field may be absent (or `undefined`) and is then omitted from the parsed value, and its
inferred property is optional. Validation rejects undeclared fields, missing required fields,
accessors, symbols, arrays, and class instances. Parsed values are deeply frozen snapshots.

Builders refuse malformed declarations with `TypeError`: an empty or duplicated `enum`, a
non-scalar enum or literal value, fewer than two or duplicate union members, and a foreign schema.
`schema.void()` is the whole-value "no input/output" type; as an array item, union member, or
object field (required or optional) it is refused, and `schema.null()` expresses a JSON null
there. Enum values and union members
keep their declared order, which is part of the document and therefore of task identity.

```ts
const review = task({
    name: "review",
    version: "1.0.0",
    instruction: "Review the diff and report findings.",
    input: schema.object({ diff: schema.string(), maxFindings: schema.optional(schema.integer()) }),
    output: schema.object({
        verdict: schema.enum(["approve", "revise"]),
        findings: schema.array(schema.object({ line: schema.integer(), note: schema.string() })),
        reason: schema.union([schema.string(), schema.null()]),
    }),
});
```

## Validation errors

`parse`, `parseInput`, and `parseOutput` throw `JSONSchemaValidationError`, a `TypeError` with the
public code `SCHEMA_VALIDATION_FAILED` and a path-level issue
([JSON Schema validation](./json-schema-validation.md#validation)): for example
`$.findings[2].line must be a safe integer` with keyword `type` and schema path
`#/properties/findings/items/properties/line/type`. A union with no matching member reports every
member's issue; an ambiguous union names the matching members. Execution records invalid provider
output as a failed outcome whose message is this path-level text.

## Adapting supported JSON Schema documents

`schema.fromJSONSchema(document)` accepts the task schema language as data and returns an
authenticated `TaskSchema<unknown>`. Accepted documents are exactly the forms in the table above,
recursively. An object's `required` array lists distinct declared property names; declared
properties outside it adapt to optional fields.

`{ type: "null" }` adapts to `schema.void()` only at the root, and to `schema.null()` everywhere
else: array item, union member, and required or optional object property. A required null field
therefore parses `null` to `null` and refuses `undefined`, so rehydrating a descriptor
(`taskDescriptorOf(taskValueOf(d))`) parses every value exactly as the original declaration.
Both builders emit the same document, so identity does not depend on the choice, and existing
artifact locks are unchanged.

The adapter validates the original data without invoking accessors, snapshots it, and rebuilds it
using the ordinary schema constructors. Property and required-field order normalize to builder
order, preserving the task artifact lock of the equivalent builder declaration. Mutating the
input document afterward cannot alter parsing or identity. Required-field membership compares
individual strings, including unusual field names, rather than joining them with a delimiter.
Non-enumerable own property names participate in that comparison. Required arrays are normalized
before iteration so inherited getters and iterator methods are not invoked during validation.

This is not a general JSON Schema engine. References other than the task value reference,
constraints such as `minLength` or `minimum`, `type` arrays, `anyOf`, annotations such as `title`,
and extra keys such as `$schema` are rejected rather than silently dropped. Use
[`compileJSONSchema`](./json-schema-validation.md) to validate arbitrary data against a broader
subset. Dynamic documents yield unknown; the API does not accept an unchecked generic type
assertion. Use ordinary builders when compile-time field inference is needed.

Adapted schemas work with task construction, registration/reopen, execution, and the typed-effect
adapter. [Public tests](../test/task/json-schema-adapter.test.ts) cover identity, validation,
mutation safety, and execution;
[`schema-builders.test.ts`](../test/task/schema-builders.test.ts) covers every widened form,
path-level refusals, provider-output refusals, registry reopen, and the published descriptor
schema. The installed custom-effect example exercises schema adaptation.

## Identity and artifact locks

The canonical task artifact contains the configured compatibility and descriptor versions,
logical name and version, behavioral instruction, and both JSON Schema documents. Its exact
artifact lock contains:

- a stable task ID derived from the logical name;
- the caller-selected task version;
- descriptor and artifact-lock protocol versions;
- the complete artifact digest;
- a separate digest of the input/output schema pair.

All hashes and prefixes come from `protocol.config.json`. Artifact property order and task object
schema declaration order do not affect identity. Widening the schema language in 3.0.0 left every
existing document byte-identical, so existing artifact locks are unchanged; the golden digests in
[`schema-builders.test.ts`](../test/task/schema-builders.test.ts) were recorded with the 2.34.1
factory. The lock is a citation, not a registry alias. The
implemented [`SQLiteTaskRegistry`](./task-registry.md) rejects one logical name/version resolving
to conflicting artifact digests.

Normative wire schemas are generated at
[`spec/schemas/task-descriptor-v1.schema.json`](../spec/schemas/task-descriptor-v1.schema.json) and
[`spec/schemas/task-artifact-lock-v1.schema.json`](../spec/schemas/task-artifact-lock-v1.schema.json).
The independent fixture is
[`test/fixtures/task-descriptor-v1.json`](../test/fixtures/task-descriptor-v1.json).
JSON Schema validates the wire shape. Task-registry decoding additionally verifies that each
object schema's required fields are distinct declared property keys, that enum values and union
members are distinct, and recomputes every configured digest.

## Current boundary

Constructing a descriptor never executes code or grants authority. Registration is a separate
durable operation. Explicit repository authority uses a separate versioned
[`RepositoryGrantedTask`](./repository-grants.md) companion artifact so existing bodyless task
artifact bytes and identities remain unchanged. Aliases, execution, effect families, and model
delivery remain outside this descriptor boundary.
