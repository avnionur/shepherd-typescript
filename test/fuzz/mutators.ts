import { kernelProtocolConfig } from "../../src/protocol/config.ts";
import type { Prng } from "../support/prng.ts";

/** Configured mutation parameters from `config/hardening-suites.config.json`. */
export type MutationSettings = {
    /** Nesting depths spliced into JSON text (exercise the pre-parse interchange limit). */
    readonly textNestingLevels: readonly number[];
    /** Absolute nesting depths built into values. */
    readonly valueNestingLevels: readonly number[];
    /**
     * Nesting depths built into values relative to `kernel.canonicalization.maxNestingDepth`, so
     * mutated values land on both sides of the canonical bound (F-016) deterministically.
     */
    readonly valueNestingBoundOffsets: readonly number[];
    readonly maxMutationsPerCase: number;
    readonly numbers: readonly string[];
    readonly oversizedStringCharacters: number;
    readonly pollutionKeys: readonly string[];
};

type Container = Record<string, unknown> | unknown[];

// Built from a code point so formatters cannot rewrite the escape into a raw control byte.
const NUL = String.fromCharCode(0);

/** Parses one configured number spelling, including non-finite values and negative zero. */
export function configuredNumber(spelling: string): number {
    if (spelling === "-0") return -0;
    return Number(spelling);
}

/** Builds `levels` nested arrays or objects around a leaf without recursion. */
export function nestValue(levels: number, kind: "array" | "object", leaf: unknown): unknown {
    let value = leaf;
    for (let level = 0; level < levels; level += 1)
        value = kind === "array" ? [value] : { a: value };
    return value;
}

/** Builds JSON text of `levels` nested arrays or objects without recursion. */
export function nestText(levels: number, kind: "array" | "object", leaf = "0"): string {
    return kind === "array"
        ? `${"[".repeat(levels)}${leaf}${"]".repeat(levels)}`
        : `${'{"a":'.repeat(levels)}${leaf}${"}".repeat(levels)}`;
}

/**
 * Deep copy for JSON-shaped values that keeps own `__proto__` keys as data. Iterative, so values
 * nested far past the call stack (which the mutators create on purpose) can be copied.
 */
export function cloneValue(value: unknown): unknown {
    const shell = (source: unknown): unknown =>
        Array.isArray(source)
            ? new Array<unknown>(source.length)
            : source !== null && typeof source === "object"
              ? {}
              : source;
    const root = shell(value);
    const pending: [unknown, unknown][] = [[value, root]];
    while (pending.length > 0) {
        const [source, target] = pending.pop() as [unknown, unknown];
        if (source === null || typeof source !== "object") continue;
        for (const [key, child] of Object.entries(source)) {
            const copy = shell(child);
            Object.defineProperty(target, key, {
                configurable: true,
                enumerable: true,
                value: copy,
                writable: true,
            });
            pending.push([child, copy]);
        }
    }
    return root;
}

/** Applies between one and the configured maximum structural mutations to a cloned value. */
export function mutateValue(seed: unknown, random: Prng, settings: MutationSettings): unknown {
    let value = cloneValue(seed);
    const count = 1 + random.int(settings.maxMutationsPerCase);
    for (let index = 0; index < count; index += 1) value = mutateValueOnce(value, random, settings);
    return value;
}

/** Applies between one and the configured maximum text mutations. */
export function mutateText(seed: string, random: Prng, settings: MutationSettings): string {
    let text = seed;
    const count = 1 + random.int(settings.maxMutationsPerCase);
    for (let index = 0; index < count; index += 1) text = mutateTextOnce(text, random, settings);
    return text;
}

function defineData(container: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(container, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    });
}

function mutateValueOnce(value: unknown, random: Prng, settings: MutationSettings): unknown {
    const containers = collectContainers(value, random);
    const replacement = (current: unknown): unknown => replaceLeaf(current, random, settings);
    if (containers.length === 0) return replacement(value);
    const container = random.pick(containers);
    const keys = Array.isArray(container)
        ? container.map((_entry, index) => String(index))
        : Object.keys(container);
    const operation = random.int(9);
    if (operation === 0 && keys.length > 0) {
        // Key deletion or array element removal.
        const key = random.pick(keys);
        if (Array.isArray(container)) container.splice(Number(key), 1);
        else delete container[key];
        return value;
    }
    if (operation === 1) {
        // Unknown or prototype-polluting key, stored as an own data property.
        const key = random.chance(0.6)
            ? random.pick(settings.pollutionKeys)
            : `fuzz_${random.int(1000)}`;
        const injected = random.chance(0.5) ? { polluted: true } : replacement(null);
        if (Array.isArray(container)) container.push(injected);
        else defineData(container, key, injected);
        return value;
    }
    if (operation === 2 && keys.length > 0 && Array.isArray(container)) {
        // Array element duplication or reordering.
        const index = random.int(container.length);
        if (random.chance(0.5)) container.splice(index, 0, cloneValue(container[index]));
        else container.reverse();
        return value;
    }
    if (keys.length === 0) {
        if (Array.isArray(container)) container.push(replacement(null));
        else defineData(container, `fuzz_${random.int(1000)}`, replacement(null));
        return value;
    }
    const key = random.pick(keys);
    if (Array.isArray(container)) {
        container[Number(key)] = replacement(container[Number(key)]);
    } else {
        defineData(container, key, replacement(container[key]));
    }
    return value;
}

/** Absolute value nesting levels plus the levels around the configured canonical bound. */
export function valueNestingLevels(settings: MutationSettings): readonly number[] {
    const bound = kernelProtocolConfig.canonicalization.maxNestingDepth;
    return [
        ...settings.valueNestingLevels,
        ...settings.valueNestingBoundOffsets.map((offset) => bound + offset),
    ];
}

function replaceLeaf(current: unknown, random: Prng, settings: MutationSettings): unknown {
    switch (random.int(10)) {
        case 0:
            // Type swap.
            return random.pick<unknown>([null, true, false, 0, 1, "", "x", [], {}]);
        case 1:
            // Huge, non-finite, negative-zero, and unsafe-integer numbers.
            return configuredNumber(random.pick(settings.numbers));
        case 2:
            return nestValue(
                random.pick(valueNestingLevels(settings)),
                random.chance(0.5) ? "array" : "object",
                current ?? 0,
            );
        case 3:
            return random.chance(0.1)
                ? "x".repeat(settings.oversizedStringCharacters)
                : "y".repeat(1 + random.int(4096));
        case 4:
            return random.pick(["\uD800", `a${NUL}b`, "../x", "/abs", "a\\b", ".", "", " "]);
        case 5:
            if (typeof current === "string" && current.length > 0) {
                const index = random.int(current.length);
                const code = current.charCodeAt(index) ^ (1 << random.int(7));
                return `${current.slice(0, index)}${String.fromCharCode(code)}${current.slice(index + 1)}`;
            }
            return current;
        case 6:
            if (typeof current === "number") return current + random.pick([1, -1, 0.5, 2 ** 53]);
            return typeof current === "string" ? current.length : String(current);
        case 7:
            return Array.isArray(current)
                ? current.slice(0, random.int(current.length + 1))
                : [current];
        case 8:
            return current !== null && typeof current === "object" ? {} : { value: current };
        default:
            return typeof current === "string" ? `${current}${current}` : current;
    }
}

function collectContainers(value: unknown, random: Prng): Container[] {
    const containers: Container[] = [];
    const pending: unknown[] = [value];
    // Bounded breadth so huge seeds do not dominate mutation time.
    while (pending.length > 0 && containers.length < 4096) {
        const current = pending.pop();
        if (current !== null && typeof current === "object") {
            containers.push(current as Container);
            const children = Object.values(current);
            if (children.length > 64) {
                for (let index = 0; index < 64; index += 1) pending.push(random.pick(children));
            } else {
                pending.push(...children);
            }
        }
    }
    return containers;
}

function mutateTextOnce(text: string, random: Prng, settings: MutationSettings): string {
    const position = text.length === 0 ? 0 : random.int(text.length);
    switch (random.int(9)) {
        case 0: {
            // UTF-8 byte flip, decoded back with replacement characters.
            const bytes = Buffer.from(text, "utf8");
            if (bytes.length === 0) return text;
            const index = random.int(bytes.length);
            bytes[index] = (bytes[index] as number) ^ (1 << random.int(8));
            return bytes.toString("utf8");
        }
        case 1:
            // Truncation.
            return text.slice(0, position);
        case 2:
            return duplicateRawKey(text, random);
        case 3: {
            // Structural mutation through a parse, when the text still parses.
            try {
                return JSON.stringify(mutateValue(JSON.parse(text), random, settings));
            } catch {
                return `${text.slice(0, position)},${text.slice(position)}`;
            }
        }
        case 4:
            // Deep nesting spliced at a value position.
            return spliceAtValue(
                text,
                random,
                nestText(
                    random.pick(settings.textNestingLevels),
                    random.chance(0.5) ? "array" : "object",
                ),
            );
        case 5:
            // Huge and non-finite number spellings.
            return spliceAtValue(
                text,
                random,
                random.pick(["1e400", "-1e400", "1e-400", "9007199254740993", "-0", "0e0", "1E2"]),
            );
        case 6:
            return spliceAtValue(
                text,
                random,
                random.chance(0.1)
                    ? JSON.stringify("x".repeat(settings.oversizedStringCharacters))
                    : '"\\ud800"',
            );
        case 7: {
            const inserted = random.pick(['"', "{", "[", "]", "}", ":", "\\", NUL, " "]);
            return `${text.slice(0, position)}${inserted}${text.slice(position)}`;
        }
        default: {
            // Prototype keys spliced into the first object.
            const brace = text.indexOf("{");
            if (brace < 0) return text;
            const key = random.pick(settings.pollutionKeys);
            return `${text.slice(0, brace + 1)}"${key}":{"polluted":true},${text.slice(brace + 1)}`;
        }
    }
}

/** Duplicates one existing raw object key with a different value, keeping JSON parseable. */
export function duplicateRawKey(text: string, random: Prng): string {
    const keys = [...text.matchAll(/"([a-z_]+)":/gu)];
    if (keys.length === 0) return text;
    const match = random.pick(keys);
    const index = match.index as number;
    const replacement = random.pick(['"dup"', "0", "null", "[]", "{}", "true"]);
    return `${text.slice(0, index)}"${match[1]}":${replacement},${text.slice(index)}`;
}

function spliceAtValue(text: string, random: Prng, value: string): string {
    const positions = [...text.matchAll(/:(?=["[{\-0-9tfn])/gu)].map(
        (match) => match.index as number,
    );
    if (positions.length === 0) return value;
    const colon = random.pick(positions) + 1;
    const rest = text.slice(colon);
    const end = scanValueEnd(rest);
    return `${text.slice(0, colon)}${value}${rest.slice(end)}`;
}

function scanValueEnd(text: string): number {
    let depth = 0;
    let inString = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
            if (character === "\\") index += 1;
            else if (character === '"') {
                inString = false;
                if (depth === 0) return index + 1;
            }
        } else if (character === '"') inString = true;
        else if (character === "[" || character === "{") depth += 1;
        else if (character === "]" || character === "}") {
            if (depth === 0) return index;
            depth -= 1;
            if (depth === 0) return index + 1;
        } else if (character === "," && depth === 0) return index;
    }
    return text.length;
}
