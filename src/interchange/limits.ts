import type { TraceArchiveLimitsConfig } from "../protocol/config-types.ts";
import { TraceArchiveLimitError } from "./errors.ts";

const OPEN_ARRAY = 0x5b;
const OPEN_OBJECT = 0x7b;
const CLOSE_ARRAY = 0x5d;
const CLOSE_OBJECT = 0x7d;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;

type Frame = { expectKey: boolean; readonly keys: Set<string> | null };

/**
 * Refuses archive text above the configured byte length or nesting depth, or with a repeated
 * object key, before it is parsed.
 *
 * `JSON.parse` keeps the last of repeated keys while other parsers keep the first or refuse, so a
 * repeated key would let two readers see different archives. The scan is one linear pass that
 * tracks object keys per open object; it does not otherwise validate JSON, which `JSON.parse`
 * still does afterwards.
 *
 * @throws {TraceArchiveLimitError} If `maxArchiveBytes` or `maxNestingDepth` is exceeded.
 * @throws {TypeError} If an object repeats a key.
 * @internal
 */
export function assertTraceArchiveText(serialized: string, limits: TraceArchiveLimitsConfig): void {
    // UTF-8 never uses fewer bytes than UTF-16 code units, so the length is a cheap lower bound.
    if (
        serialized.length > limits.maxArchiveBytes ||
        Buffer.byteLength(serialized, "utf8") > limits.maxArchiveBytes
    ) {
        throw new TraceArchiveLimitError("maxArchiveBytes", limits.maxArchiveBytes);
    }
    const stack: Frame[] = [];
    for (let index = 0; index < serialized.length; index += 1) {
        const code = serialized.charCodeAt(index);
        if (code === QUOTE) {
            const start = index;
            for (index += 1; index < serialized.length; index += 1) {
                const inner = serialized.charCodeAt(index);
                if (inner === BACKSLASH) index += 1;
                else if (inner === QUOTE) break;
            }
            const frame = stack.at(-1);
            const keys = frame?.expectKey === true ? frame.keys : null;
            if (keys !== null) {
                (frame as Frame).expectKey = false;
                const key = readKey(serialized.slice(start, index + 1));
                if (keys.has(key)) throw new TypeError("trace archive repeats an object key");
                keys.add(key);
            }
        } else if (code === OPEN_ARRAY || code === OPEN_OBJECT) {
            if (stack.length === limits.maxNestingDepth) {
                throw new TraceArchiveLimitError("maxNestingDepth", limits.maxNestingDepth);
            }
            stack.push({ expectKey: true, keys: code === OPEN_OBJECT ? new Set() : null });
        } else if (code === CLOSE_ARRAY || code === CLOSE_OBJECT) {
            stack.pop();
        } else if (code === COMMA) {
            const frame = stack.at(-1);
            if (frame !== undefined) frame.expectKey = true;
        }
    }
}

function readKey(raw: string): string {
    if (!raw.includes("\\")) return raw.slice(1, -1);
    try {
        // Escaped spellings of one key name must collide, so escapes are decoded.
        return JSON.parse(raw) as string;
    } catch {
        // Malformed text is refused by the full parse that follows the scan.
        return raw;
    }
}

/**
 * Refuses one parsed archive collection above its configured count before it is decoded.
 *
 * @throws {TraceArchiveLimitError} If the collection is longer than its limit.
 * @internal
 */
export function assertTraceArchiveCount(
    value: unknown,
    limit: keyof TraceArchiveLimitsConfig,
    limits: TraceArchiveLimitsConfig,
): void {
    if (Array.isArray(value) && value.length > limits[limit]) {
        throw new TraceArchiveLimitError(limit, limits[limit]);
    }
}
