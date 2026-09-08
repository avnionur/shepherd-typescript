import type { SemanticRecord, SemanticValue } from "../canonical/canonical-record.ts";
import { createCanonicalSnapshot } from "../canonical/snapshot.ts";
import { assertTaskSemanticRecord, assertTaskText, readTaskDataObject } from "./validation.ts";

/** Validates one canonical document against the supported task-schema language. @internal */
export function assertSupportedTaskSchemaDocument(value: SemanticRecord, subject: string): void {
    const typeDescriptor = Object.getOwnPropertyDescriptor(value, "type");
    if (typeDescriptor === undefined || typeof typeDescriptor.value !== "string") {
        throw new TypeError(`${subject} must declare a supported type`);
    }
    if (typeDescriptor.value === "string" || typeDescriptor.value === "null") {
        readTaskDataObject(value, ["type"], subject);
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
    const propertyKeys = Object.keys(properties).sort();
    const required = createCanonicalSnapshot({
        required: fields.required as SemanticValue,
    }).required;
    if (
        !Array.isArray(required) ||
        required.some((field) => typeof field !== "string") ||
        required.length !== propertyKeys.length ||
        [...required].sort().some((field, index) => field !== propertyKeys[index])
    ) {
        throw new TypeError(`${subject} required fields must equal its property keys`);
    }
    for (const [key, property] of Object.entries(properties)) {
        assertSupportedTaskSchemaDocument(property, `${subject}.${key}`);
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
