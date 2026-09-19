/** Deterministic seeded pseudo-random generator (mulberry32) returning values in [0, 1). */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
}

/** Seeded helper over one mulberry32 stream. */
export type Prng = {
    /** Next value in [0, 1). */
    readonly next: () => number;
    /** Uniform integer in [0, bound). */
    readonly int: (bound: number) => number;
    /** Uniform element of a non-empty array. */
    readonly pick: <T>(values: readonly T[]) => T;
    /** True with the given probability. */
    readonly chance: (probability: number) => boolean;
};

/** Wraps one seeded stream with integer, choice, and probability helpers. */
export function createPrng(seed: number): Prng {
    const next = seededRandom(seed);
    const int = (bound: number): number => Math.floor(next() * bound);
    return {
        chance: (probability) => next() < probability,
        int,
        next,
        pick: <T>(values: readonly T[]): T => {
            if (values.length === 0) throw new RangeError("cannot pick from an empty array");
            return values[int(values.length)] as T;
        },
    };
}

/** Derives a stable per-case seed from a run seed, a target name, and a case index. */
export function deriveSeed(seed: number, name: string, index: number): number {
    let hash = (seed ^ 0x811c9dc5) >>> 0;
    for (const character of `${name}#${index}`) {
        hash = Math.imul(hash ^ (character.codePointAt(0) as number), 0x01000193) >>> 0;
    }
    return hash;
}
