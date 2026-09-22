type Frame = {
    index: number;
    wroteMember: boolean;
    readonly keys: readonly string[] | null;
    readonly value: Readonly<Record<string, unknown>> | readonly unknown[];
};

/**
 * Serializes plain JSON data to the exact text `JSON.stringify(value)` produces, walking the
 * value with an explicit stack instead of native recursion.
 *
 * Native `JSON.stringify` recurses per nesting level, and the native stack it may use differs by
 * platform: on Linux, Node 24 refuses plain objects nested a little over 4,000 levels even from
 * a shallow caller. This serializer accepts any depth the heap allows and its result does
 * not depend on the caller's stack. The output is byte-identical to `JSON.stringify` for plain
 * data: arrays, objects (own enumerable string keys in `Object.keys` order, which is the order
 * `JSON.stringify` uses), strings, finite and non-finite numbers, booleans, and `null`. Object
 * members whose value is `undefined`, a function, or a symbol are omitted, and array elements of
 * those kinds are written as `null`, exactly as natively. `toJSON` methods are not consulted, so
 * callers must not pass values that rely on them (such as `Date`).
 *
 * @param value - Plain JSON data; the root must be an array, object, or JSON scalar.
 * @returns Whitespace-free JSON text identical to `JSON.stringify(value)`.
 * @throws {TypeError} If the value contains a cycle or a `bigint`, or the root is not
 * serializable (`undefined`, a function, or a symbol).
 * @throws {RangeError} If the output exceeds the engine's maximum string length.
 *
 * @example
 * ```ts
 * serializeJsonText({ b: [1, undefined], a: "x", c: undefined });
 * // '{"b":[1,null],"a":"x"}'
 * ```
 */
export function serializeJsonText(value: unknown): string {
    const stack: Frame[] = [];
    const open = new Set<object>();
    const root = openValue(value, stack, open);
    if (root === undefined) {
        throw new TypeError("JSON text root must be an array, object, or JSON scalar");
    }
    let output = root;
    while (stack.length > 0) {
        const frame = stack.at(-1) as Frame;
        if (frame.keys === null) {
            const array = frame.value as readonly unknown[];
            if (frame.index === array.length) {
                output += "]";
                close(stack, open);
                continue;
            }
            const element = array[frame.index];
            if (frame.index > 0) output += ",";
            frame.index += 1;
            output += openValue(element, stack, open) ?? "null";
            continue;
        }
        if (frame.index === frame.keys.length) {
            output += "}";
            close(stack, open);
            continue;
        }
        const key = frame.keys[frame.index] as string;
        frame.index += 1;
        const text = openValue(
            (frame.value as Readonly<Record<string, unknown>>)[key],
            stack,
            open,
        );
        if (text === undefined) continue;
        output += `${frame.wroteMember ? "," : ""}${JSON.stringify(key)}:${text}`;
        frame.wroteMember = true;
    }
    return output;
}

/**
 * Returns the opening text of `value`, pushing a frame for a container, or `undefined` for a
 * value `JSON.stringify` omits.
 */
function openValue(value: unknown, stack: Frame[], open: Set<object>): string | undefined {
    if (value === null || typeof value !== "object") {
        // Scalars never consult toJSON; strings and numbers use the native JSON spelling, and
        // undefined, functions, and symbols yield undefined exactly as natively.
        return JSON.stringify(value) as string | undefined;
    }
    if (open.has(value)) {
        throw new TypeError("JSON text value contains a cycle");
    }
    open.add(value);
    if (Array.isArray(value)) {
        stack.push({ index: 0, keys: null, value, wroteMember: false });
        return "[";
    }
    const record = value as Readonly<Record<string, unknown>>;
    stack.push({ index: 0, keys: Object.keys(record), value: record, wroteMember: false });
    return "{";
}

function close(stack: Frame[], open: Set<object>): void {
    open.delete((stack.pop() as Frame).value);
}
