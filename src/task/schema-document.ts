import {
    canonicalizeSemanticValue,
    type SemanticRecord,
    type SemanticValue,
} from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { taskProtocolConfig } from "../protocol/config.ts";
import { assertTaskSemanticRecord, assertTaskText, readTaskDataObject } from "./validation.ts";

const TASK_VALUE_REFERENCE_KEY = "$ref";
const SCALAR_TYPES: ReadonlySet<string> = new Set([
    "boolean",
    "integer",
    "null",
    "number",
    "string",
]);

/** Minimum member count of a task union; a single-member union is the member itself. @internal */
export const TASK_UNION_MIN_MEMBERS = 2;

/** Scalar value admitted by task enum and literal schemas. */
export type TaskSchemaScalar = boolean | null | number | string;

/** Whether one canonical document is the published task-value schema reference. @internal */
export function isTaskValueSchemaDocument(value: SemanticRecord): boolean {
    return hasSchemaKeyword(value, TASK_VALUE_REFERENCE_KEY);
}

/** Whether one own property is present on a document without invoking accessors. @internal */
export function hasSchemaKeyword(value: SemanticRecord, keyword: string): boolean {
    return Object.getOwnPropertyDescriptor(value, keyword) !== undefined;
}

/**
 * Validates one canonical document against the supported task-schema language.
 *
 * Accepted forms are exactly the documents the schema builders emit: a scalar `type`
 * (`string`, `null`, `number`, `integer`, `boolean`), `{ type: "array", items }`, a non-empty
 * distinct scalar `enum`, a scalar `const`, a `oneOf` of at least two distinct members, a strict
 * object whose `required` names are distinct declared properties, and the published task-value
 * reference. @internal
 */
export function assertSupportedTaskSchemaDocument(value: SemanticRecord, subject: string): void {
    if (isTaskValueSchemaDocument(value)) {
        const reference = readTaskDataObject(value, [TASK_VALUE_REFERENCE_KEY], subject);
        if (reference[TASK_VALUE_REFERENCE_KEY] !== taskProtocolConfig.schemas.valueId) {
            throw new TypeError(`${subject} may only reference the published task value schema`);
        }
        return;
    }
    if (hasSchemaKeyword(value, "enum")) {
        readTaskSchemaScalars(readTaskDataObject(value, ["enum"], subject).enum, `${subject} enum`);
        return;
    }
    if (hasSchemaKeyword(value, "const")) {
        assertTaskSchemaScalar(
            readTaskDataObject(value, ["const"], subject).const,
            `${subject} const`,
        );
        return;
    }
    if (hasSchemaKeyword(value, "oneOf")) {
        readTaskUnionMembers(
            readTaskDataObject(value, ["oneOf"], subject).oneOf,
            `${subject} oneOf`,
        ).forEach((member, index) => {
            assertSupportedTaskSchemaDocument(member, `${subject}.oneOf[${index}]`);
        });
        return;
    }
    const typeDescriptor = Object.getOwnPropertyDescriptor(value, "type");
    if (typeDescriptor === undefined || typeof typeDescriptor.value !== "string") {
        throw new TypeError(`${subject} must declare a supported type`);
    }
    if (SCALAR_TYPES.has(typeDescriptor.value)) {
        readTaskDataObject(value, ["type"], subject);
        return;
    }
    if (typeDescriptor.value === "array") {
        const fields = readTaskDataObject(value, ["items", "type"], subject);
        assertTaskSemanticRecord(fields.items, `${subject}.items`);
        assertSupportedTaskSchemaDocument(fields.items, `${subject}.items`);
        return;
    }
    if (typeDescriptor.value !== "object") {
        throw new TypeError(`${subject} type is unsupported`);
    }
    const fields = readTaskDataObject(
        value,
        ["additionalProperties", "properties", "required", "type"],
        subject,
    );
    if (fields.additionalProperties !== false) {
        throw new TypeError(`${subject} must reject additional properties`);
    }
    const properties = readSchemaProperties(fields.properties, `${subject} properties`);
    readRequiredFields(fields.required, properties, subject);
    for (const [key, property] of Object.entries(properties)) {
        assertSupportedTaskSchemaDocument(property, `${subject}.${key}`);
    }
}

/**
 * Reads a strict object document's `required` array as the set of required property names.
 *
 * The array is normalized before iteration, so inherited getters and iterator methods are never
 * invoked. Names must be distinct strings naming declared properties. @internal
 */
export function readRequiredFields(
    value: unknown,
    properties: Readonly<Record<string, unknown>>,
    subject: string,
): ReadonlySet<string> {
    const required = createCanonicalSnapshot({ required: value as SemanticValue }).required;
    if (
        !Array.isArray(required) ||
        required.some((field) => typeof field !== "string" || !Object.hasOwn(properties, field)) ||
        new Set(required).size !== required.length
    ) {
        throw new TypeError(`${subject} required fields must be distinct declared property keys`);
    }
    return new Set(required as readonly string[]);
}

/** Validates one scalar admitted by task enum and literal schemas. @internal */
export function assertTaskSchemaScalar(
    value: unknown,
    subject: string,
): asserts value is TaskSchemaScalar {
    if (
        value !== null &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value)) &&
        !(typeof value === "string" && !/[\uD800-\uDFFF]/u.test(value))
    ) {
        throw new TypeError(
            `${subject} must be a well-formed string, finite number, boolean, or null`,
        );
    }
}

/** Reads a non-empty list of distinct task schema scalars. @internal */
export function readTaskSchemaScalars(
    value: unknown,
    subject: string,
): readonly TaskSchemaScalar[] {
    const values = readDenseArray(value, subject);
    values.forEach((member, index) => {
        assertTaskSchemaScalar(member, `${subject}[${index}]`);
    });
    assertDistinct(values as readonly SemanticValue[], 1, subject);
    return Object.freeze(values as TaskSchemaScalar[]);
}

/** Reads the distinct canonical member documents of one task union. @internal */
export function readTaskUnionMembers(value: unknown, subject: string): readonly SemanticRecord[] {
    const members = readDenseArray(value, subject).map((member, index) => {
        assertTaskSemanticRecord(member, `${subject}[${index}]`);
        return member;
    });
    assertDistinct(members, TASK_UNION_MIN_MEMBERS, subject);
    return members;
}

/** Reads one dense plain array's elements without invoking accessors. @internal */
export function readDenseArray(value: unknown, subject: string): readonly unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${subject} must be a plain array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = value.length;
    if (
        Object.getOwnPropertySymbols(value).length > 0 ||
        Object.keys(descriptors).length !== length + 1
    ) {
        throw new TypeError(`${subject} must be a dense array without custom properties`);
    }
    return Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`${subject}[${index}] must be a data element`);
        }
        return descriptor.value as unknown;
    });
}

function assertDistinct(values: readonly SemanticValue[], minimum: number, subject: string): void {
    if (
        values.length < minimum ||
        new Set(values.map((member) => canonicalizeSemanticValue(member))).size !== values.length
    ) {
        throw new TypeError(`${subject} must list at least ${minimum} distinct value(s)`);
    }
}

function readSchemaProperties(value: unknown, subject: string): Record<string, SemanticRecord> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const properties = readTaskDataObject(value, Object.getOwnPropertyNames(value), subject);
    for (const [key, property] of Object.entries(properties)) {
        assertTaskText(key, `${subject} field name`);
        assertTaskSemanticRecord(property, `${subject}.${key}`);
    }
    return properties as Record<string, SemanticRecord>;
}
