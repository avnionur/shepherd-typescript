import { recordIdConfig, scopeProtocolConfig } from "../protocol/config.ts";

/** Validates one non-empty well-formed scope-domain string. @internal */
export function assertScopeText(value: unknown, subject: string): asserts value is string {
    if (typeof value !== "string" || value.length === 0 || /[\uD800-\uDFFF]/u.test(value)) {
        throw new TypeError(`${subject} must be a non-empty well-formed string`);
    }
}

/** Validates one configured content-addressed scope identity. @internal */
export function assertScopeId(value: unknown, subject: string): asserts value is string {
    assertPrefixedDigest(value, scopeProtocolConfig.identity.scopeIdPrefix, subject);
}

/** Validates one configured deterministic origin-cut identity. @internal */
export function assertScopeOriginCutId(value: unknown, subject: string): asserts value is string {
    assertPrefixedDigest(value, scopeProtocolConfig.identity.originCutIdPrefix, subject);
}

/** Validates an optional Unix-millisecond timestamp, defaulting to the current time. @internal */
export function readNowMilliseconds(value: unknown, subject: string): number {
    if (value === undefined) {
        return Date.now();
    }
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new TypeError(`${subject} must be a non-negative safe integer`);
    }
    return value as number;
}

/** Reads an exact plain scope-domain data object without invoking accessors. @internal */
export function readScopeDataObject(
    value: unknown,
    keys: readonly string[],
    subject: string,
    optionalKeys: readonly string[] = [],
): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) ||
        Object.getOwnPropertySymbols(value).length > 0
    ) {
        throw new TypeError(`${subject} must be a plain data object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const declaredKeys = [...keys, ...optionalKeys];
    if (
        Object.keys(descriptors).some((key) => !declaredKeys.includes(key)) ||
        keys.some((key) => descriptors[key] === undefined)
    ) {
        throw new TypeError(`${subject} must contain exactly its declared fields`);
    }
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of declaredKeys) {
        const descriptor = descriptors[key];
        if (descriptor === undefined) {
            fields[key] = undefined;
            continue;
        }
        if (!("value" in descriptor)) {
            throw new TypeError(`${subject} ${key} must be a data property`);
        }
        fields[key] = descriptor.value;
    }
    return fields;
}

/** Reads a dense array of values without custom properties. @internal */
export function readScopeArray(value: unknown, subject: string): readonly unknown[] {
    if (
        !Array.isArray(value) ||
        Object.getOwnPropertySymbols(value).length > 0 ||
        Object.keys(value).some((key, index) => key !== String(index))
    ) {
        throw new TypeError(`${subject} must be a dense array`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(descriptors)) {
        if (!("value" in (descriptors[key] as PropertyDescriptor))) {
            throw new TypeError(`${subject} must contain only data elements`);
        }
    }
    return value;
}

function assertPrefixedDigest(value: unknown, prefix: string, subject: string): void {
    if (typeof value !== "string") {
        throw new TypeError(`${subject} must be a string`);
    }
    const hex = value.slice(prefix.length);
    if (
        !value.startsWith(prefix) ||
        hex.length !== recordIdConfig.hexLength ||
        !/^[0-9a-f]+$/u.test(hex)
    ) {
        throw new TypeError(`${subject} must be a configured ${prefix} identifier`);
    }
}
