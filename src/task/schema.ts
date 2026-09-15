import type { SemanticRecord } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { assertSupportedTaskSchemaDocument, isTaskValueSchemaDocument } from "./schema-document.ts";
import type { TaskValue } from "./types.ts";
import { assertTaskSemanticRecord } from "./validation.ts";
import { readTaskValue } from "./value-codec.ts";

type SchemaParser<T> = (value: unknown, path: string) => T;

type SchemaMetadata<T> = {
    readonly document: SemanticRecord;
    readonly parse: SchemaParser<T>;
};

const schemaMetadata = new WeakMap<object, SchemaMetadata<unknown>>();

/** Runtime schema carrying a JSON Schema document and an inferred output type. */
export type TaskSchema<T> = {
    /**
     * Validates and snapshots one untrusted value.
     *
     * @param value - Untrusted task input or output.
     * @returns A validated immutable value.
     * @throws {TypeError} If the value does not satisfy this schema.
     */
    readonly parse: (value: unknown) => T;
    /**
     * Returns the deeply frozen JSON Schema 2020-12 document.
     *
     * @returns The canonical schema document included in task identity.
     */
    readonly toJSONSchema: () => SemanticRecord;
};

/** Infers the validated value type represented by a task schema. */
export type InferTaskSchema<S extends TaskSchema<unknown>> =
    S extends TaskSchema<infer T> ? T : never;

/** Shape accepted by `schema.object()`. */
export type TaskSchemaShape = Readonly<Record<string, TaskSchema<unknown>>>;

/** Value inferred from a task object-schema shape. */
export type InferTaskSchemaShape<S extends TaskSchemaShape> = {
    readonly [K in keyof S]: InferTaskSchema<S[K]>;
};

/** Public factory surface for the supported task schema primitives. */
export type TaskSchemaFactory = {
    /**
     * Adapts the supported JSON Schema subset into an authenticated runtime schema.
     *
     * @param document - Untrusted string, null, or strict required-field object schema document.
     * @returns A frozen schema yielding unknown, with builder-normalized required-field order.
     * @throws {TypeError} If the document is unsafe or uses unsupported schema vocabulary.
     */
    readonly fromJSONSchema: (document: unknown) => TaskSchema<unknown>;
    /**
     * Creates a strict object schema whose declared fields are all required.
     *
     * @param shape - Named fields mapped to package-created task schemas.
     * @returns A schema inferring a readonly object value.
     * @throws {TypeError} If the shape is unsafe or contains a foreign schema.
     */
    readonly object: <S extends TaskSchemaShape>(shape: S) => TaskSchema<InferTaskSchemaShape<S>>;
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
    /** @returns A void-output schema accepting `undefined` or JSON `null`. */
    readonly void: () => TaskSchema<void>;
};

/** Task input/output schema builders with static type inference and runtime validation. */
export const schema: TaskSchemaFactory = Object.freeze({
    fromJSONSchema: createSchemaFromJSONSchema,
    object: createObjectSchema,
    string: createStringSchema,
    task: createTaskValueSchema,
    void: createVoidSchema,
});

function createSchemaFromJSONSchema(value: unknown): TaskSchema<unknown> {
    assertTaskSemanticRecord(value, "task schema document");
    assertSupportedTaskSchemaDocument(value, "task schema document");
    const document = createCanonicalSnapshot(value);
    if (isTaskValueSchemaDocument(document)) return createTaskValueSchema();
    if (document.type === "string") return createStringSchema();
    if (document.type === "null") return createVoidSchema();
    const properties = document.properties as Readonly<Record<string, SemanticRecord>>;
    return createObjectSchema(
        Object.fromEntries(
            Object.entries(properties).map(([key, child]) => [
                key,
                createSchemaFromJSONSchema(child),
            ]),
        ),
    );
}

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

function createStringSchema(): TaskSchema<string> {
    return createTaskSchema({ type: "string" }, (value, path) => {
        if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) {
            throw new TypeError(`${path} must be a well-formed string`);
        }
        return value;
    });
}

function createTaskValueSchema(): TaskSchema<TaskValue> {
    return createTaskSchema({ $ref: taskProtocolConfig.schemas.valueId }, (value, path) => {
        try {
            return readTaskValue(value);
        } catch (error) {
            throw new TypeError(`${path} must be a canonical task value`, { cause: error });
        }
    });
}

function createVoidSchema(): TaskSchema<void> {
    return createTaskSchema({ type: "null" }, (value, path) => {
        if (value !== undefined && value !== null) {
            throw new TypeError(`${path} must be void`);
        }
    });
}

function createObjectSchema<S extends TaskSchemaShape>(
    shape: S,
): TaskSchema<InferTaskSchemaShape<S>> {
    const fields = readSchemaShape(shape);
    const properties = Object.create(null) as Record<string, SemanticRecord>;
    for (const [key, field] of fields) {
        properties[key] = taskSchemaMetadata(field).document;
    }
    return createTaskSchema(
        {
            additionalProperties: false,
            properties,
            required: fields.map(([key]) => key),
            type: "object",
        },
        (value, path) => parseObject(fields, value, path) as InferTaskSchemaShape<S>,
    );
}

function createTaskSchema<T>(document: SemanticRecord, parser: SchemaParser<T>): TaskSchema<T> {
    const frozenDocument = createCanonicalSnapshot(document);
    const taskSchema = Object.freeze({
        parse: (value: unknown): T => parser(value, "$"),
        toJSONSchema: (): SemanticRecord => frozenDocument,
    });
    schemaMetadata.set(taskSchema, { document: frozenDocument, parse: parser });
    return taskSchema;
}

function readSchemaShape(
    shape: TaskSchemaShape,
): readonly (readonly [string, TaskSchema<unknown>])[] {
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
        .map((key) => {
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
            taskSchemaMetadata(descriptor.value as TaskSchema<unknown>);
            return [key, descriptor.value as TaskSchema<unknown>] as const;
        });
}

function parseObject(
    fields: readonly (readonly [string, TaskSchema<unknown>])[],
    value: unknown,
    path: string,
): Readonly<Record<string, unknown>> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${path} must be a plain object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).sort().join("\0") !== fields.map(([key]) => key).join("\0")) {
        throw new TypeError(`${path} must contain exactly its declared task schema fields`);
    }
    const parsed: Record<string, unknown> = {};
    for (const [key, field] of fields) {
        const descriptor = descriptors[key];
        /* node:coverage disable */
        if (descriptor === undefined) {
            throw new TypeError(`${path}.${key} disappeared during validation`);
        }
        /* node:coverage enable */
        if (!("value" in descriptor)) {
            throw new TypeError(`${path}.${key} must be a data property`);
        }
        Object.defineProperty(parsed, key, {
            configurable: false,
            enumerable: true,
            value: taskSchemaMetadata(field).parse(descriptor.value, `${path}.${key}`),
            writable: false,
        });
    }
    return Object.freeze(parsed);
}
