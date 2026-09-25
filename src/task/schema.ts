import { canonicalizeSemanticValue, type SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { type JSONSchemaIssue, JSONSchemaValidationError } from "../schema/errors.ts";
import { appendSchemaPath, escapeSchemaPointer } from "../schema/json-schema-validator.ts";
import {
    assertSupportedTaskSchemaDocument,
    assertTaskSchemaScalar,
    hasSchemaKeyword,
    isTaskValueSchemaDocument,
    readDenseArray,
    readRequiredFields,
    readTaskSchemaScalars,
    readTaskUnionMembers,
    type TaskSchemaScalar,
} from "./schema-document.ts";
import type { TaskValue } from "./types.ts";
import { assertTaskSemanticRecord } from "./validation.ts";
import { readTaskValue } from "./value-codec.ts";

export type { TaskSchemaScalar } from "./schema-document.ts";

type SchemaParser<T> = (value: unknown, path: string, schemaPath: string) => T;

type SchemaMetadata<T> = {
    readonly document: SemanticRecord;
    readonly parse: SchemaParser<T>;
};

type ShapeField = {
    readonly key: string;
    readonly optional: boolean;
    readonly schema: TaskSchema<unknown>;
};

/** Position of a document: `{ type: "null" }` adapts to void only at the root. */
type DocumentPosition = "nested" | "root";

type UnionMembers = readonly [TaskSchema<unknown>, TaskSchema<unknown>, ...TaskSchema<unknown>[]];

const schemaMetadata = new WeakMap<object, SchemaMetadata<unknown>>();
const optionalSchemas = new WeakSet<object>();
const voidSchemas = new WeakSet<object>();

/** Runtime schema carrying a JSON Schema document and an inferred output type. */
export type TaskSchema<T> = {
    /**
     * Validates and snapshots one untrusted value.
     *
     * @param value - Untrusted task input or output.
     * @returns A validated immutable value.
     * @throws {JSONSchemaValidationError} If the value does not satisfy this schema. The error is
     * a `TypeError` whose issues name the refused path, keyword, and schema location.
     */
    readonly parse: (value: unknown) => T;
    /**
     * Returns the deeply frozen JSON Schema 2020-12 document.
     *
     * @returns The canonical schema document included in task identity.
     */
    readonly toJSONSchema: () => SemanticRecord;
};

/**
 * Marker declaring one object field optional; accepted only inside `schema.object()` shapes.
 *
 * The field's document is the wrapped schema's document; the parent object omits the field from
 * `required`.
 */
export type TaskOptionalSchema<T> = {
    /** Always `true`; distinguishes the marker from a task schema. */
    readonly optional: true;
    /** Wrapped schema validating the field when it is present. */
    readonly schema: TaskSchema<T>;
};

/** Infers the validated value type represented by a task schema. */
export type InferTaskSchema<S extends TaskSchema<unknown>> =
    S extends TaskSchema<infer T> ? T : never;

/** Shape accepted by `schema.object()`: field names mapped to schemas or optional markers. */
export type TaskSchemaShape = Readonly<
    Record<string, TaskSchema<unknown> | TaskOptionalSchema<unknown>>
>;

/** Keys of a task object-schema shape declared with `schema.optional()`. */
export type OptionalTaskSchemaShapeKeys<S extends TaskSchemaShape> = {
    [K in keyof S]-?: S[K] extends TaskOptionalSchema<unknown> ? K : never;
}[keyof S];

/** Value inferred from one task object-schema shape field. */
export type InferTaskSchemaShapeField<F> =
    F extends TaskOptionalSchema<infer T> ? T : F extends TaskSchema<infer T> ? T : never;

/** Value inferred from a task object-schema shape; optional fields become optional properties. */
export type InferTaskSchemaShape<S extends TaskSchemaShape> = {
    readonly [K in Exclude<keyof S, OptionalTaskSchemaShapeKeys<S>>]: InferTaskSchemaShapeField<
        S[K]
    >;
} & {
    readonly [K in OptionalTaskSchemaShapeKeys<S>]?: InferTaskSchemaShapeField<S[K]>;
};

/** Public factory surface for the supported task schema forms. */
export type TaskSchemaFactory = {
    /**
     * Creates a schema accepting a dense array whose every item satisfies `items`.
     *
     * @param items - Package-created item schema; `schema.void()` is refused, use `schema.null()`.
     * @returns A schema emitting `{ type: "array", items }` and inferring a readonly array.
     * @throws {TypeError} If `items` is foreign or a void schema.
     */
    readonly array: <S extends TaskSchema<unknown>>(
        items: S,
    ) => TaskSchema<readonly InferTaskSchema<S>[]>;
    /** @returns A schema emitting `{ type: "boolean" }` and accepting `true` or `false`. */
    readonly boolean: () => TaskSchema<boolean>;
    /**
     * Creates a schema accepting exactly one of the listed scalar values.
     *
     * Declared order is part of the document and therefore of task identity.
     *
     * @param values - Non-empty, distinct well-formed strings, finite numbers, booleans, or null.
     * @returns A schema emitting `{ enum: values }` and inferring the union of the values.
     * @throws {TypeError} If the list is empty, repeats a value, or holds a non-scalar.
     *
     * @example
     * ```ts
     * const verdict = schema.enum(["accepted", "rejected"]);
     * ```
     */
    readonly enum: <const V extends readonly [TaskSchemaScalar, ...TaskSchemaScalar[]]>(
        values: V,
    ) => TaskSchema<V[number]>;
    /**
     * Adapts one supported JSON Schema document into an authenticated runtime schema.
     *
     * Accepted documents are exactly the forms the builders emit. `{ type: "null" }` adapts to
     * `schema.void()` at the root and to `schema.null()` everywhere else (array item, union
     * member, required or optional object property).
     *
     * @param document - Untrusted document in the supported task schema language.
     * @returns A frozen schema yielding unknown, with builder-normalized required-field order.
     * @throws {TypeError} If the document is unsafe or uses unsupported schema vocabulary.
     */
    readonly fromJSONSchema: (document: unknown) => TaskSchema<unknown>;
    /** @returns A schema emitting `{ type: "integer" }` and accepting safe integers. */
    readonly integer: () => TaskSchema<number>;
    /**
     * Creates a schema accepting exactly one scalar value.
     *
     * @param value - Well-formed string, finite number, boolean, or null.
     * @returns A schema emitting `{ const: value }` and inferring the literal type.
     * @throws {TypeError} If the value is not a scalar.
     */
    readonly literal: <const V extends TaskSchemaScalar>(value: V) => TaskSchema<V>;
    /** @returns A schema emitting `{ type: "null" }` and accepting only JSON `null`. */
    readonly null: () => TaskSchema<null>;
    /** @returns A schema emitting `{ type: "number" }` and accepting finite numbers. */
    readonly number: () => TaskSchema<number>;
    /**
     * Creates a strict object schema. Fields are required unless wrapped in `schema.optional()`.
     *
     * @param shape - Named fields mapped to package-created task schemas or optional markers;
     * `schema.void()` is refused as a field, use `schema.null()`.
     * @returns A schema inferring a readonly object value.
     * @throws {TypeError} If the shape is unsafe or contains a foreign or void schema.
     */
    readonly object: <S extends TaskSchemaShape>(shape: S) => TaskSchema<InferTaskSchemaShape<S>>;
    /**
     * Marks one object field optional: an absent or `undefined` value is omitted from the result.
     *
     * @param schema - Package-created field schema; `schema.void()` is refused, use `schema.null()`.
     * @returns A marker accepted only inside `schema.object()` shapes.
     * @throws {TypeError} If `schema` is foreign or a void schema.
     *
     * @example
     * ```ts
     * const input = schema.object({ path: schema.string(), note: schema.optional(schema.string()) });
     * ```
     */
    readonly optional: <S extends TaskSchema<unknown>>(
        schema: S,
    ) => TaskOptionalSchema<InferTaskSchema<S>>;
    /** @returns A schema accepting well-formed strings. */
    readonly string: () => TaskSchema<string>;
    /**
     * Creates a schema accepting one canonical task value.
     *
     * The document is a reference to the published task value JSON Schema, so a task can accept
     * another task as data or emit a task definition as its output without embedding the
     * descriptor grammar. Parsing validates through the task value decoder: extra keys, foreign
     * schema documents, unsupported grammar, and mismatched locks are refused.
     *
     * @returns A schema inferring a task value.
     */
    readonly task: () => TaskSchema<TaskValue>;
    /**
     * Creates a schema accepting a value that satisfies exactly one member (JSON Schema `oneOf`).
     *
     * A value matching several members is refused as ambiguous. Declared order is part of task
     * identity.
     *
     * @param members - At least two distinct package-created schemas; void schemas are refused.
     * @returns A schema emitting `{ oneOf: members }` and inferring the union of member types.
     * @throws {TypeError} If fewer than two members, a duplicate, a foreign, or a void schema is
     * supplied.
     *
     * @example
     * ```ts
     * const reason = schema.union([schema.string(), schema.null()]);
     * ```
     */
    readonly union: <const S extends UnionMembers>(
        members: S,
    ) => TaskSchema<InferTaskSchema<S[number]>>;
    /**
     * @returns A whole-value void schema accepting `undefined` or JSON `null`, valid only as a task
     * input or output; array items, union members, and object fields use `schema.null()`.
     */
    readonly void: () => TaskSchema<void>;
};

/** Task input/output schema builders with static type inference and runtime validation. */
export const schema: TaskSchemaFactory = Object.freeze({
    array: createArraySchema,
    boolean: createBooleanSchema,
    enum: createEnumSchema,
    fromJSONSchema: (document: unknown): TaskSchema<unknown> => {
        assertTaskSemanticRecord(document, "task schema document");
        assertSupportedTaskSchemaDocument(document, "task schema document");
        return adaptDocument(createCanonicalSnapshot(document), "root");
    },
    integer: createIntegerSchema,
    literal: createLiteralSchema,
    null: createNullSchema,
    number: createNumberSchema,
    object: createObjectSchema,
    optional: createOptionalSchema,
    string: createStringSchema,
    task: createTaskValueSchema,
    union: createUnionSchema,
    void: createVoidSchema,
});

/**
 * Returns trusted internal metadata for a schema produced by this package.
 *
 * @param value - Task schema to authenticate.
 * @returns Internal immutable document and path-aware parser.
 * @throws {TypeError} If the schema was not created by this module.
 *
 * @internal
 */
export function taskSchemaMetadata<T>(value: TaskSchema<T>): SchemaMetadata<T> {
    const metadata = schemaMetadata.get(value) as SchemaMetadata<T> | undefined;
    if (metadata === undefined) {
        throw new TypeError("task schemas must be created by the configured schema factory");
    }
    return metadata;
}

function adaptDocument(document: SemanticRecord, position: DocumentPosition): TaskSchema<unknown> {
    if (isTaskValueSchemaDocument(document)) return createTaskValueSchema();
    if (hasSchemaKeyword(document, "enum")) {
        return createEnumSchema(document.enum as readonly [TaskSchemaScalar]);
    }
    if (hasSchemaKeyword(document, "const")) {
        return createLiteralSchema(document.const as TaskSchemaScalar);
    }
    if (hasSchemaKeyword(document, "oneOf")) {
        return createUnionSchema(
            (document.oneOf as readonly SemanticRecord[]).map((member) =>
                adaptDocument(member, "nested"),
            ) as unknown as UnionMembers,
        );
    }
    switch (document.type) {
        case "array":
            return createArraySchema(adaptDocument(document.items as SemanticRecord, "nested"));
        case "boolean":
            return createBooleanSchema();
        case "integer":
            return createIntegerSchema();
        case "null":
            return position === "root" ? createVoidSchema() : createNullSchema();
        case "number":
            return createNumberSchema();
        case "string":
            return createStringSchema();
        default:
            break;
    }
    const properties = document.properties as Readonly<Record<string, SemanticRecord>>;
    const required = readRequiredFields(document.required, properties, "task schema document");
    return createObjectSchema(
        Object.fromEntries(
            Object.entries(properties).map(([key, child]) => {
                const field = adaptDocument(child, "nested");
                return [key, required.has(key) ? field : createOptionalSchema(field)];
            }),
        ),
    );
}

function refuse(
    path: string,
    schemaPath: string,
    keyword: string,
    message: string,
    options?: ErrorOptions,
): never {
    throw new JSONSchemaValidationError(
        [{ keyword, message, path, schemaPath: `${schemaPath}/${keyword}` }],
        undefined,
        options,
    );
}

function createStringSchema(): TaskSchema<string> {
    return createTaskSchema({ type: "string" }, (value, path, schemaPath) => {
        if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) {
            refuse(path, schemaPath, "type", "must be a well-formed string");
        }
        return value;
    });
}

function createNumberSchema(): TaskSchema<number> {
    return createTaskSchema({ type: "number" }, (value, path, schemaPath) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            refuse(path, schemaPath, "type", "must be a finite number");
        }
        return value;
    });
}

function createIntegerSchema(): TaskSchema<number> {
    return createTaskSchema({ type: "integer" }, (value, path, schemaPath) => {
        if (typeof value !== "number" || !Number.isSafeInteger(value)) {
            refuse(path, schemaPath, "type", "must be a safe integer");
        }
        return value;
    });
}

function createBooleanSchema(): TaskSchema<boolean> {
    return createTaskSchema({ type: "boolean" }, (value, path, schemaPath) => {
        if (typeof value !== "boolean") refuse(path, schemaPath, "type", "must be a boolean");
        return value;
    });
}

function createNullSchema(): TaskSchema<null> {
    return createTaskSchema({ type: "null" }, (value, path, schemaPath) => {
        if (value !== null) refuse(path, schemaPath, "type", "must be null");
        return null;
    });
}

function createEnumSchema<const V extends readonly [TaskSchemaScalar, ...TaskSchemaScalar[]]>(
    values: V,
): TaskSchema<V[number]> {
    const members = readTaskSchemaScalars(values, "task enum schema values");
    const listed = members.map((member) => canonicalizeSemanticValue(member)).join(", ");
    return createTaskSchema({ enum: members }, (value, path, schemaPath) => {
        if (!members.some((member) => member === value)) {
            refuse(path, schemaPath, "enum", `must be one of ${listed}`);
        }
        return value as V[number];
    });
}

function createLiteralSchema<const V extends TaskSchemaScalar>(value: V): TaskSchema<V> {
    assertTaskSchemaScalar(value, "task literal schema value");
    const text = canonicalizeSemanticValue(value);
    return createTaskSchema({ const: value }, (candidate, path, schemaPath) => {
        if (candidate !== value) refuse(path, schemaPath, "const", `must equal ${text}`);
        return value;
    });
}

function createArraySchema<S extends TaskSchema<unknown>>(
    items: S,
): TaskSchema<readonly InferTaskSchema<S>[]> {
    const item = readNestedSchema(items, "task array schema items");
    return createTaskSchema({ items: item.document, type: "array" }, (value, path, schemaPath) => {
        let elements: readonly unknown[];
        try {
            elements = readDenseArray(value, path);
        } catch (error) {
            refuse(path, schemaPath, "type", "must be a dense plain array", { cause: error });
        }
        return Object.freeze(
            elements.map((element, index) =>
                item.parse(element, appendSchemaPath(path, index), `${schemaPath}/items`),
            ),
        ) as readonly InferTaskSchema<S>[];
    });
}

function createUnionSchema<const S extends UnionMembers>(
    members: S,
): TaskSchema<InferTaskSchema<S[number]>> {
    const parsers = readDenseArray(members, "task union schema members").map((member, index) =>
        readNestedSchema(member as TaskSchema<unknown>, `task union schema member ${index}`),
    );
    const documents = readTaskUnionMembers(
        parsers.map((member) => member.document),
        "task union schema members",
    );
    return createTaskSchema({ oneOf: documents }, (value, path, schemaPath) => {
        const branchIssues: JSONSchemaIssue[] = [];
        const matched: { readonly index: number; readonly value: unknown }[] = [];
        parsers.forEach((member, index) => {
            try {
                matched.push({
                    index,
                    value: member.parse(value, path, `${schemaPath}/oneOf/${index}`),
                });
            } catch (error) {
                if (!(error instanceof JSONSchemaValidationError)) throw error;
                branchIssues.push(...error.issues);
            }
        });
        const [only] = matched;
        if (only !== undefined && matched.length === 1) {
            return only.value as InferTaskSchema<S[number]>;
        }
        const message =
            only === undefined
                ? "must match exactly one union member; it matches none"
                : `must match exactly one union member; it matches members ${matched
                      .map((entry) => entry.index)
                      .join(", ")}`;
        throw new JSONSchemaValidationError([
            { keyword: "oneOf", message, path, schemaPath: `${schemaPath}/oneOf` },
            ...(only === undefined ? branchIssues : []),
        ]);
    });
}

function createOptionalSchema<S extends TaskSchema<unknown>>(
    inner: S,
): TaskOptionalSchema<InferTaskSchema<S>> {
    readNestedSchema(inner, "task optional schema");
    const marker: TaskOptionalSchema<InferTaskSchema<S>> = Object.freeze({
        optional: true as const,
        schema: inner as TaskSchema<InferTaskSchema<S>>,
    });
    optionalSchemas.add(marker);
    return marker;
}

function createTaskValueSchema(): TaskSchema<TaskValue> {
    return createTaskSchema(
        { $ref: taskProtocolConfig.schemas.valueId },
        (value, path, schemaPath) => {
            try {
                return readTaskValue(value);
            } catch (error) {
                refuse(path, schemaPath, "$ref", "must be a canonical task value", {
                    cause: error,
                });
            }
        },
    );
}

function createVoidSchema(): TaskSchema<void> {
    const voidSchema = createTaskSchema({ type: "null" }, (value, path, schemaPath) => {
        if (value !== undefined && value !== null) {
            refuse(path, schemaPath, "type", "must be void");
        }
    });
    voidSchemas.add(voidSchema);
    return voidSchema;
}

function createObjectSchema<S extends TaskSchemaShape>(
    shape: S,
): TaskSchema<InferTaskSchemaShape<S>> {
    const fields = readSchemaShape(shape);
    const properties = Object.create(null) as Record<string, SemanticRecord>;
    for (const field of fields) {
        properties[field.key] = taskSchemaMetadata(field.schema).document;
    }
    return createTaskSchema(
        {
            additionalProperties: false,
            properties,
            required: fields.filter((field) => !field.optional).map((field) => field.key),
            type: "object",
        },
        (value, path, schemaPath) =>
            parseObject(fields, value, path, schemaPath) as InferTaskSchemaShape<S>,
    );
}

function createTaskSchema<T>(document: SemanticRecord, parser: SchemaParser<T>): TaskSchema<T> {
    const frozenDocument = createCanonicalSnapshot(document);
    const taskSchema = Object.freeze({
        parse: (value: unknown): T => parser(value, "$", "#"),
        toJSONSchema: (): SemanticRecord => frozenDocument,
    });
    schemaMetadata.set(taskSchema, { document: frozenDocument, parse: parser });
    return taskSchema;
}

function readNestedSchema(value: TaskSchema<unknown>, subject: string): SchemaMetadata<unknown> {
    const metadata = taskSchemaMetadata(value);
    if (voidSchemas.has(value)) {
        throw new TypeError(`${subject} must not be a void schema; use schema.null()`);
    }
    return metadata;
}

function readSchemaShape(shape: TaskSchemaShape): readonly ShapeField[] {
    if (
        shape === null ||
        typeof shape !== "object" ||
        Array.isArray(shape) ||
        (Object.getPrototypeOf(shape) !== Object.prototype &&
            Object.getPrototypeOf(shape) !== null) ||
        Object.getOwnPropertySymbols(shape).length > 0
    ) {
        throw new TypeError("task object schema shape must be a plain data object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(shape);
    return Object.keys(descriptors)
        .sort()
        .map((key): ShapeField => {
            if (key.length === 0 || /[\uD800-\uDFFF]/u.test(key)) {
                throw new TypeError(
                    "task object schema field names must be well-formed and non-empty",
                );
            }
            const descriptor = descriptors[key];
            /* node:coverage disable */
            if (descriptor === undefined) {
                throw new TypeError(
                    `task object schema field ${key} disappeared during validation`,
                );
            }
            /* node:coverage enable */
            if (!("value" in descriptor)) {
                throw new TypeError(`task object schema field ${key} must be a data property`);
            }
            const field = descriptor.value as TaskSchema<unknown> | TaskOptionalSchema<unknown>;
            if (optionalSchemas.has(field)) {
                return {
                    key,
                    optional: true,
                    schema: (field as TaskOptionalSchema<unknown>).schema,
                };
            }
            readNestedSchema(field as TaskSchema<unknown>, `task object schema field ${key}`);
            return { key, optional: false, schema: field as TaskSchema<unknown> };
        });
}

function parseObject(
    fields: readonly ShapeField[],
    value: unknown,
    path: string,
    schemaPath: string,
): Readonly<Record<string, unknown>> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        refuse(path, schemaPath, "type", "must be a plain object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const declared = new Set(fields.map((field) => field.key));
    for (const key of Object.keys(descriptors).sort()) {
        if (!declared.has(key)) {
            refuse(
                appendSchemaPath(path, key),
                schemaPath,
                "additionalProperties",
                "is not a declared task schema field",
            );
        }
    }
    const parsed: Record<string, unknown> = {};
    for (const field of fields) {
        const fieldPath = appendSchemaPath(path, field.key);
        const descriptor = descriptors[field.key];
        if (descriptor !== undefined && !("value" in descriptor)) {
            refuse(fieldPath, schemaPath, "type", "must be a data property");
        }
        if (descriptor === undefined || (field.optional && descriptor.value === undefined)) {
            if (field.optional) continue;
            refuse(fieldPath, schemaPath, "required", "is a required task schema field");
        }
        Object.defineProperty(parsed, field.key, {
            configurable: false,
            enumerable: true,
            value: taskSchemaMetadata(field.schema).parse(
                descriptor.value,
                fieldPath,
                `${schemaPath}/properties/${escapeSchemaPointer(field.key)}`,
            ),
            writable: false,
        });
    }
    return Object.freeze(parsed);
}
