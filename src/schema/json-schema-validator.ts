import { canonicalizeSemanticValue, type SemanticValue } from "../canonical/canonical-record.ts";
import { CanonicalNestingLimitError } from "../canonical/errors.ts";
import { kernelProtocolConfig } from "../protocol/config.ts";
import { deepFreeze } from "../protocol/config-value-readers.ts";
import { type JSONSchemaIssue, JSONSchemaValidationError } from "./errors.ts";

/**
 * JSON Schema 2020-12 keywords `compileJSONSchema` evaluates, in addition to the boolean schemas
 * `true` and `false`. Any other keyword is refused at compile time rather than silently ignored.
 *
 * `$schema` is accepted only at the document root and only with the configured dialect
 * (`kernel.schemas.dialect`); `$comment`, `description`, and `title` are annotations.
 *
 * @public
 */
export const JSON_SCHEMA_SUPPORTED_KEYWORDS = Object.freeze([
    "$comment",
    "$schema",
    "additionalProperties",
    "allOf",
    "anyOf",
    "const",
    "description",
    "enum",
    "exclusiveMaximum",
    "exclusiveMinimum",
    "items",
    "maxItems",
    "maxLength",
    "maximum",
    "minItems",
    "minLength",
    "minimum",
    "oneOf",
    "pattern",
    "properties",
    "required",
    "title",
    "type",
    "uniqueItems",
] as const);

/** JSON Schema document accepted by {@link compileJSONSchema}: a boolean or an object schema. */
export type JSONSchemaDocument = boolean | { readonly [key: string]: SemanticValue | undefined };

/** Compiled, reusable validator for one JSON Schema document. */
export type JSONSchemaValidator = {
    /** Deeply frozen canonical snapshot of the compiled document. */
    readonly document: JSONSchemaDocument;
    /**
     * Validates one untrusted value and returns every issue.
     *
     * The value must first be canonical JSON data (plain objects, dense arrays, finite numbers,
     * well-formed strings, booleans, and null, without accessors or cycles); otherwise a single
     * `json` issue at `$` is returned. Accessors are never invoked.
     *
     * @param value - Untrusted value.
     * @returns Every path-level issue in document order; empty when the value is valid.
     * @throws {CanonicalNestingLimitError} If the value nests deeper than the configured bound.
     */
    readonly validate: (value: unknown) => readonly JSONSchemaIssue[];
    /**
     * Validates one untrusted value and returns its deeply frozen canonical snapshot.
     *
     * @param value - Untrusted value.
     * @param subject - Optional description of the value prefixed to the error message.
     * @returns The canonical snapshot of the valid value.
     * @throws {JSONSchemaValidationError} If the value has at least one issue.
     * @throws {CanonicalNestingLimitError} If the value nests deeper than the configured bound.
     */
    readonly parse: (value: unknown, subject?: string) => SemanticValue;
};

type JsonValue = SemanticValue;

type CompiledSchema = boolean | CompiledNode;

type CompiledNode = {
    readonly additionalProperties: CompiledSchema | null;
    readonly allOf: readonly CompiledSchema[] | null;
    readonly anyOf: readonly CompiledSchema[] | null;
    readonly const: string | null;
    readonly enum: readonly string[] | null;
    readonly exclusiveMaximum: number | null;
    readonly exclusiveMinimum: number | null;
    readonly items: CompiledSchema | null;
    readonly maxItems: number | null;
    readonly maxLength: number | null;
    readonly maximum: number | null;
    readonly minItems: number | null;
    readonly minLength: number | null;
    readonly minimum: number | null;
    readonly oneOf: readonly CompiledSchema[] | null;
    readonly pattern: RegExp | null;
    readonly properties: ReadonlyMap<string, CompiledSchema> | null;
    readonly required: readonly string[];
    readonly types: readonly string[] | null;
    readonly uniqueItems: boolean;
};

const TYPE_NAMES: ReadonlySet<string> = new Set([
    "array",
    "boolean",
    "integer",
    "null",
    "number",
    "object",
    "string",
]);
const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set(JSON_SCHEMA_SUPPORTED_KEYWORDS);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/**
 * Compiles one JSON Schema document in the supported 2020-12 subset into a reusable validator.
 *
 * The document is snapshotted canonically (accessors, cycles, non-finite numbers, and malformed
 * strings are refused) and every keyword is checked against {@link JSON_SCHEMA_SUPPORTED_KEYWORDS}
 * before any value is validated, so an unsupported or malformed document fails at compile time.
 * `type` is a type name or a non-empty array of distinct names; `integer` accepts any number with
 * a zero fractional part. String lengths count Unicode code points; `pattern` is an ECMAScript
 * regular expression evaluated with the `u` flag. `enum`, `const`, and `uniqueItems` compare
 * canonical JSON, so object key order never matters. `oneOf` requires exactly one matching member.
 *
 * @param document - Untrusted JSON Schema document or boolean schema.
 * @returns A frozen validator whose `validate` reports every path-level issue.
 * @throws {TypeError} If the document is not canonical data, uses a keyword outside the supported
 * subset, declares a malformed keyword value, or names another `$schema` dialect.
 * @throws {CanonicalNestingLimitError} If the document nests deeper than the configured bound.
 *
 * @example
 * ```ts
 * const action = compileJSONSchema({
 *     type: "object",
 *     additionalProperties: false,
 *     properties: { kind: { enum: ["observe", "accept"] }, worker_id: { type: ["string", "null"] } },
 *     required: ["kind", "worker_id"],
 * });
 * action.validate({ kind: "merge", worker_id: null });
 * // [{ path: "$.kind", keyword: "enum", schemaPath: "#/properties/kind/enum", message: "..." }]
 * ```
 *
 * @public
 */
export function compileJSONSchema(document: unknown): JSONSchemaValidator {
    const snapshot = snapshotJson(document, "JSON Schema document");
    const compiled = compileSchema(snapshot, "#", true);
    const validate = (value: unknown): readonly JSONSchemaIssue[] => {
        const read = readJsonValue(value);
        if ("issue" in read) return Object.freeze([read.issue]);
        const issues: JSONSchemaIssue[] = [];
        validateSchema(compiled, read.value, "$", "#", issues);
        return Object.freeze(issues);
    };
    return Object.freeze({
        document: snapshot as JSONSchemaDocument,
        parse: (value: unknown, subject?: string): SemanticValue => {
            const read = readJsonValue(value);
            const issues: JSONSchemaIssue[] = [];
            if ("issue" in read) issues.push(read.issue);
            else validateSchema(compiled, read.value, "$", "#", issues);
            if (issues.length > 0) throw new JSONSchemaValidationError(issues, subject);
            return (read as { readonly value: JsonValue }).value;
        },
        validate,
    });
}

/**
 * Appends one object key or array index to a `$`-rooted value path.
 *
 * @param path - Parent path.
 * @param key - Object key or array index.
 * @returns `.key` for identifier keys, `["key"]` otherwise, and `[index]` for indices.
 *
 * @internal
 */
export function appendSchemaPath(path: string, key: string | number): string {
    if (typeof key === "number") return `${path}[${key}]`;
    return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function snapshotJson(value: unknown, subject: string): JsonValue {
    try {
        return deepFreeze(
            JSON.parse(canonicalizeSemanticValue(value as SemanticValue)) as JsonValue,
        );
    } catch (error) {
        if (error instanceof CanonicalNestingLimitError) throw error;
        throw new TypeError(`${subject} must be canonical JSON data`, { cause: error });
    }
}

function readJsonValue(
    value: unknown,
): { readonly value: JsonValue } | { readonly issue: JSONSchemaIssue } {
    try {
        return { value: snapshotJson(value, "value") };
    } catch (error) {
        if (error instanceof CanonicalNestingLimitError) throw error;
        return {
            issue: {
                keyword: "json",
                message: "must be canonical JSON data",
                path: "$",
                schemaPath: "#",
            },
        };
    }
}

function compileSchema(value: JsonValue, schemaPath: string, root: boolean): CompiledSchema {
    if (typeof value === "boolean") return value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`JSON Schema ${schemaPath} must be a boolean or an object schema`);
    }
    const node = value as Readonly<Record<string, JsonValue>>;
    for (const keyword of Object.keys(node)) {
        if (!SUPPORTED_KEYWORDS.has(keyword)) {
            throw new TypeError(`JSON Schema ${schemaPath} uses unsupported keyword ${keyword}`);
        }
    }
    const at = (keyword: string): string => `${schemaPath}/${escapeSchemaPointer(keyword)}`;
    if (node.$schema !== undefined) {
        if (!root || node.$schema !== kernelProtocolConfig.schemas.dialect) {
            throw new TypeError(
                `JSON Schema ${at("$schema")} must name the configured dialect at the root`,
            );
        }
    }
    for (const annotation of ["$comment", "description", "title"]) {
        if (node[annotation] !== undefined && typeof node[annotation] !== "string") {
            throw new TypeError(`JSON Schema ${at(annotation)} must be a string`);
        }
    }
    return Object.freeze({
        additionalProperties:
            node.additionalProperties === undefined
                ? null
                : compileSchema(node.additionalProperties, at("additionalProperties"), false),
        allOf: readSchemaList(node.allOf, at("allOf")),
        anyOf: readSchemaList(node.anyOf, at("anyOf")),
        const: node.const === undefined ? null : canonicalizeSemanticValue(node.const),
        enum: readEnum(node.enum, at("enum")),
        exclusiveMaximum: readNumber(node.exclusiveMaximum, at("exclusiveMaximum")),
        exclusiveMinimum: readNumber(node.exclusiveMinimum, at("exclusiveMinimum")),
        items: node.items === undefined ? null : compileSchema(node.items, at("items"), false),
        maxItems: readCount(node.maxItems, at("maxItems")),
        maxLength: readCount(node.maxLength, at("maxLength")),
        maximum: readNumber(node.maximum, at("maximum")),
        minItems: readCount(node.minItems, at("minItems")),
        minLength: readCount(node.minLength, at("minLength")),
        minimum: readNumber(node.minimum, at("minimum")),
        oneOf: readSchemaList(node.oneOf, at("oneOf")),
        pattern: readPattern(node.pattern, at("pattern")),
        properties: readProperties(node.properties, at("properties")),
        required: readRequired(node.required, at("required")),
        types: readTypes(node.type, at("type")),
        uniqueItems: readUniqueItems(node.uniqueItems, at("uniqueItems")),
    });
}

function readSchemaList(
    value: JsonValue | undefined,
    schemaPath: string,
): readonly CompiledSchema[] | null {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError(`JSON Schema ${schemaPath} must be a non-empty array of schemas`);
    }
    return Object.freeze(
        value.map((member, index) => compileSchema(member, `${schemaPath}/${index}`, false)),
    );
}

function readEnum(value: JsonValue | undefined, schemaPath: string): readonly string[] | null {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length === 0) {
        throw new TypeError(`JSON Schema ${schemaPath} must be a non-empty array`);
    }
    return Object.freeze(value.map((member) => canonicalizeSemanticValue(member)));
}

function readNumber(value: JsonValue | undefined, schemaPath: string): number | null {
    if (value === undefined) return null;
    if (typeof value !== "number") {
        throw new TypeError(`JSON Schema ${schemaPath} must be a finite number`);
    }
    return value;
}

function readCount(value: JsonValue | undefined, schemaPath: string): number | null {
    if (value === undefined) return null;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`JSON Schema ${schemaPath} must be a non-negative safe integer`);
    }
    return value as number;
}

function readPattern(value: JsonValue | undefined, schemaPath: string): RegExp | null {
    if (value === undefined) return null;
    if (typeof value !== "string") {
        throw new TypeError(`JSON Schema ${schemaPath} must be a string`);
    }
    try {
        return new RegExp(value, "u");
    } catch (error) {
        throw new TypeError(`JSON Schema ${schemaPath} must be a valid regular expression`, {
            cause: error,
        });
    }
}

function readProperties(
    value: JsonValue | undefined,
    schemaPath: string,
): ReadonlyMap<string, CompiledSchema> | null {
    if (value === undefined) return null;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`JSON Schema ${schemaPath} must be an object of schemas`);
    }
    return new Map(
        Object.entries(value as Readonly<Record<string, JsonValue>>).map(([key, member]) => [
            key,
            compileSchema(member, `${schemaPath}/${escapeSchemaPointer(key)}`, false),
        ]),
    );
}

function readRequired(value: JsonValue | undefined, schemaPath: string): readonly string[] {
    if (value === undefined) return Object.freeze([]);
    if (
        !Array.isArray(value) ||
        value.some((member) => typeof member !== "string") ||
        new Set(value).size !== value.length
    ) {
        throw new TypeError(`JSON Schema ${schemaPath} must be an array of distinct strings`);
    }
    return Object.freeze([...(value as readonly string[])]);
}

function readTypes(value: JsonValue | undefined, schemaPath: string): readonly string[] | null {
    if (value === undefined) return null;
    const names = Array.isArray(value) ? value : [value];
    if (
        names.length === 0 ||
        names.some((name) => typeof name !== "string" || !TYPE_NAMES.has(name)) ||
        new Set(names).size !== names.length
    ) {
        throw new TypeError(
            `JSON Schema ${schemaPath} must be a type name or a non-empty array of distinct names`,
        );
    }
    return Object.freeze([...(names as readonly string[])]);
}

function readUniqueItems(value: JsonValue | undefined, schemaPath: string): boolean {
    if (value === undefined) return false;
    if (typeof value !== "boolean") {
        throw new TypeError(`JSON Schema ${schemaPath} must be a boolean`);
    }
    return value;
}

function validateSchema(
    schema: CompiledSchema,
    value: JsonValue,
    path: string,
    schemaPath: string,
    issues: JSONSchemaIssue[],
): void {
    if (schema === true) return;
    if (schema === false) {
        issues.push({ keyword: "false", message: "is not allowed", path, schemaPath });
        return;
    }
    const at = (keyword: string): string => `${schemaPath}/${keyword}`;
    const report = (keyword: string, message: string, issuePath = path): void => {
        issues.push({ keyword, message, path: issuePath, schemaPath: at(keyword) });
    };
    if (schema.types !== null && !schema.types.some((name) => hasType(value, name))) {
        report("type", `must be ${schema.types.join(" or ")}`);
    }
    if (schema.const !== null && canonicalizeSemanticValue(value) !== schema.const) {
        report("const", `must equal ${schema.const}`);
    }
    if (schema.enum !== null && !schema.enum.includes(canonicalizeSemanticValue(value))) {
        report("enum", `must be one of ${schema.enum.join(", ")}`);
    }
    if (typeof value === "number") validateNumber(schema, value, report);
    if (typeof value === "string") validateString(schema, value, report);
    if (Array.isArray(value)) validateArray(schema, value, path, schemaPath, issues, report);
    else if (value !== null && typeof value === "object") {
        validateObject(
            schema,
            value as Readonly<Record<string, JsonValue>>,
            path,
            schemaPath,
            issues,
            report,
        );
    }
    if (schema.allOf !== null) {
        schema.allOf.forEach((member, index) => {
            validateSchema(member, value, path, `${at("allOf")}/${index}`, issues);
        });
    }
    if (schema.anyOf !== null) {
        const branches = evaluateBranches(schema.anyOf, value, path, at("anyOf"));
        if (!branches.some((branch) => branch.length === 0)) {
            report("anyOf", "must match at least one anyOf member");
            issues.push(...branches.flat());
        }
    }
    if (schema.oneOf !== null) {
        const branches = evaluateBranches(schema.oneOf, value, path, at("oneOf"));
        const matched = branches.flatMap((branch, index) => (branch.length === 0 ? [index] : []));
        if (matched.length === 0) {
            report("oneOf", "must match exactly one oneOf member; it matches none");
            issues.push(...branches.flat());
        } else if (matched.length > 1) {
            report(
                "oneOf",
                `must match exactly one oneOf member; it matches members ${matched.join(", ")}`,
            );
        }
    }
}

type Report = (keyword: string, message: string, issuePath?: string) => void;

function validateNumber(schema: CompiledNode, value: number, report: Report): void {
    if (schema.minimum !== null && value < schema.minimum) {
        report("minimum", `must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== null && value > schema.maximum) {
        report("maximum", `must be <= ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== null && value <= schema.exclusiveMinimum) {
        report("exclusiveMinimum", `must be > ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== null && value >= schema.exclusiveMaximum) {
        report("exclusiveMaximum", `must be < ${schema.exclusiveMaximum}`);
    }
}

function validateString(schema: CompiledNode, value: string, report: Report): void {
    const length = [...value].length;
    if (schema.minLength !== null && length < schema.minLength) {
        report("minLength", `must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.maxLength !== null && length > schema.maxLength) {
        report("maxLength", `must contain at most ${schema.maxLength} character(s)`);
    }
    if (schema.pattern !== null && !schema.pattern.test(value)) {
        report("pattern", `must match pattern ${schema.pattern.source}`);
    }
}

function validateArray(
    schema: CompiledNode,
    value: readonly JsonValue[],
    path: string,
    schemaPath: string,
    issues: JSONSchemaIssue[],
    report: Report,
): void {
    if (schema.minItems !== null && value.length < schema.minItems) {
        report("minItems", `must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== null && value.length > schema.maxItems) {
        report("maxItems", `must contain at most ${schema.maxItems} item(s)`);
    }
    if (schema.uniqueItems) {
        const seen = new Map<string, number>();
        value.forEach((item, index) => {
            const text = canonicalizeSemanticValue(item);
            const first = seen.get(text);
            if (first === undefined) seen.set(text, index);
            else {
                report(
                    "uniqueItems",
                    `must not repeat item ${first}`,
                    appendSchemaPath(path, index),
                );
            }
        });
    }
    const items = schema.items;
    if (items !== null) {
        value.forEach((item, index) => {
            validateSchema(
                items,
                item,
                appendSchemaPath(path, index),
                `${schemaPath}/items`,
                issues,
            );
        });
    }
}

function validateObject(
    schema: CompiledNode,
    value: Readonly<Record<string, JsonValue>>,
    path: string,
    schemaPath: string,
    issues: JSONSchemaIssue[],
    report: Report,
): void {
    for (const key of schema.required) {
        if (!Object.hasOwn(value, key)) {
            report("required", "is required", appendSchemaPath(path, key));
        }
    }
    for (const [key, member] of Object.entries(value)) {
        const memberPath = appendSchemaPath(path, key);
        const declared = schema.properties?.get(key);
        if (declared !== undefined) {
            validateSchema(
                declared,
                member,
                memberPath,
                `${schemaPath}/properties/${escapeSchemaPointer(key)}`,
                issues,
            );
        } else if (schema.additionalProperties === false) {
            report("additionalProperties", "is not a declared property", memberPath);
        } else if (schema.additionalProperties !== null) {
            validateSchema(
                schema.additionalProperties,
                member,
                memberPath,
                `${schemaPath}/additionalProperties`,
                issues,
            );
        }
    }
}

function evaluateBranches(
    members: readonly CompiledSchema[],
    value: JsonValue,
    path: string,
    schemaPath: string,
): readonly (readonly JSONSchemaIssue[])[] {
    return members.map((member, index) => {
        const branch: JSONSchemaIssue[] = [];
        validateSchema(member, value, path, `${schemaPath}/${index}`, branch);
        return branch;
    });
}

function hasType(value: JsonValue, name: string): boolean {
    switch (name) {
        case "array":
            return Array.isArray(value);
        case "boolean":
            return typeof value === "boolean";
        case "integer":
            return typeof value === "number" && Number.isInteger(value);
        case "null":
            return value === null;
        case "number":
            return typeof value === "number";
        case "object":
            return value !== null && typeof value === "object" && !Array.isArray(value);
        default:
            return typeof value === "string";
    }
}

/**
 * Escapes one key as a JSON Pointer reference token (`~` to `~0`, `/` to `~1`).
 *
 * @param key - Object key.
 * @returns The escaped reference token.
 *
 * @internal
 */
export function escapeSchemaPointer(key: string): string {
    return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
