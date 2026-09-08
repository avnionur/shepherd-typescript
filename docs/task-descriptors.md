# Task Descriptors

Implementation:
[`src/task/descriptor.ts`](../src/task/descriptor.ts),
[`src/task/schema.ts`](../src/task/schema.ts), and
[`src/task/types.ts`](../src/task/types.ts). Public exports:
[`src/index.ts`](../src/index.ts). Tests:
[`test/task/descriptor.test.ts`](../test/task/descriptor.test.ts) and
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

The current schema factory implements strict required-field objects, well-formed strings, and
void outputs. Object validation rejects missing or additional fields, accessors, symbols, arrays,
and class instances. Validated object inputs are immutable snapshots. A void output accepts
TypeScript `undefined` or JSON `null` and resolves to `undefined`.

## Adapting supported JSON Schema documents

`schema.fromJSONSchema(document)` accepts the existing schema language as data and returns an
authenticated `TaskSchema<unknown>`. Accepted forms are exactly `{ type: "string" }`,
`{ type: "null" }`, or an object with `type: "object"`, `additionalProperties: false`,
`properties`, and a `required` array containing every property name exactly once.
Properties recursively use the same supported forms.

The adapter validates the original data without invoking accessors, snapshots it, and rebuilds it
using the ordinary schema constructors. Property and required-field order normalize to builder
order, preserving the task artifact lock of the equivalent builder declaration. Mutating the
input document afterward cannot alter parsing or identity. Required-field equality compares
individual strings, including unusual field names, rather than joining them with a delimiter.
Non-enumerable own property names participate in that comparison. Required arrays are normalized
before iteration so inherited getters and iterator methods are not invoked during validation.

This is not a general JSON Schema engine. Arrays, numbers, unions, references, optional fields,
constraints such as minLength, annotations such as title, and extra keys such as $schema are
rejected rather than silently dropped. Null adapts to the existing void schema, whose parsed
value is undefined. Dynamic documents yield unknown; the API does not accept an unchecked generic
type assertion. Use ordinary builders when compile-time field inference is needed.

Adapted schemas work with task construction, registration/reopen, execution, and the typed-effect
adapter. [Public tests](../test/task/json-schema-adapter.test.ts) cover identity, validation,
mutation safety, and execution; the installed custom-effect example exercises schema adaptation.

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
schema declaration order do not affect identity. The lock is a citation, not a registry alias. The
implemented [`SQLiteTaskRegistry`](./task-registry.md) rejects one logical name/version resolving
to conflicting artifact digests.

Normative wire schemas are generated at
[`spec/schemas/task-descriptor-v1.schema.json`](../spec/schemas/task-descriptor-v1.schema.json) and
[`spec/schemas/task-artifact-lock-v1.schema.json`](../spec/schemas/task-artifact-lock-v1.schema.json).
The independent fixture is
[`test/fixtures/task-descriptor-v1.json`](../test/fixtures/task-descriptor-v1.json).
JSON Schema validates the wire shape. Task-registry decoding additionally verifies that each
object schema's required fields equal its property keys and recomputes every configured digest.

## Current boundary

Constructing a descriptor never executes code or grants authority. Registration is a separate
durable operation. Explicit repository authority uses a separate versioned
[`RepositoryGrantedTask`](./repository-grants.md) companion artifact so existing bodyless task
artifact bytes and identities remain unchanged. Aliases, execution, effect families, and model
delivery remain outside this descriptor boundary.
