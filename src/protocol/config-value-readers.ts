/** Reads an object with the required closed field set. */
export function readObject(
    value: unknown,
    keys: readonly string[],
    path: string,
    allowAdditionalKeys = false,
): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    const object = value as Record<string, unknown>;
    if (
        !keys.every((key) => Object.hasOwn(object, key)) ||
        (!allowAdditionalKeys && Object.keys(object).some((key) => !keys.includes(key)))
    ) {
        throw new TypeError(`${path} must contain exactly its declared fields`);
    }
    return object;
}

/** Reads an array value. */
export function readArray(value: unknown, path: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${path} must be an array`);
    }
    return value;
}

/** Reads a non-empty array of unique non-empty strings. */
export function readUniqueStrings(value: unknown, path: string): readonly string[] {
    const values = readArray(value, path).map((entry, index) =>
        readNonEmptyString(entry, `${path}[${index}]`),
    );
    if (values.length === 0 || new Set(values).size !== values.length) {
        throw new TypeError(`${path} must contain unique non-empty values`);
    }
    return values;
}

/** Reads a recursively valid JSON object. */
export function readJsonObject(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    const source = readObject(value, Object.keys(value), path);
    const object = Object.create(null) as Record<string, unknown>;
    for (const [key, child] of Object.entries(source)) {
        readWellFormedString(key, `${path} key`);
        object[key] = copyJsonValue(child, `${path}.${key}`);
    }
    return object;
}

/** Reads a non-empty well-formed string. */
export function readNonEmptyString(value: unknown, path: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${path} must be a non-empty well-formed string`);
    }
    return readWellFormedString(value, path);
}

/** Reads an absolute URL string. */
export function readAbsoluteUrl(value: unknown, path: string): string {
    const url = readNonEmptyString(value, path);
    if (URL.parse(url) === null) {
        throw new TypeError(`${path} must be an absolute URL`);
    }
    return url;
}

/** Reads a member of a closed string-literal set. */
export function readEnum<const T extends readonly string[]>(
    value: unknown,
    allowed: T,
    path: string,
): T[number] {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new TypeError(`${path} must be one of: ${allowed.join(", ")}`);
    }
    return value;
}

/** Reads a safe integer. */
export function readSafeInteger(value: unknown, path: string): number {
    if (!Number.isSafeInteger(value)) {
        throw new TypeError(`${path} must be a safe integer`);
    }
    return value as number;
}

/** Reads a non-negative safe integer. */
export function readNonNegativeInteger(value: unknown, path: string): number {
    const integer = readSafeInteger(value, path);
    if (integer < 0) {
        throw new TypeError(`${path} must not be negative`);
    }
    return integer;
}

/** Reads a positive safe integer. */
export function readPositiveInteger(value: unknown, path: string): number {
    const integer = readSafeInteger(value, path);
    if (integer < 1) {
        throw new TypeError(`${path} must be positive`);
    }
    return integer;
}

/** Requires a critical safety flag to remain enabled. */
export function readRequiredTrue(value: unknown, path: string): true {
    if (value !== true) {
        throw new TypeError(`${path} must be true`);
    }
    return true;
}

/** Compares ordered string constants without coercion. */
export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Recursively freezes a validated configuration snapshot. */
export function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value)) {
            deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

function copyJsonValue(value: unknown, path: string): unknown {
    if (value === null || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        return readWellFormedString(value, path);
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError(`${path} must contain finite JSON numbers`);
        }
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((child, index) => copyJsonValue(child, `${path}[${index}]`));
    }
    if (typeof value === "object") {
        return readJsonObject(value, path);
    }
    throw new TypeError(`${path} must contain only JSON values`);
}

function readWellFormedString(value: string, path: string): string {
    if (/[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${path} must be a well-formed string`);
    }
    return value;
}
