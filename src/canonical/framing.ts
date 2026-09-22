/**
 * Location of an embedded record body inside one kernel framing value: the property names and
 * array indices walked from the frame root to the body. Each step crosses exactly one enclosing
 * container, so the path length is the number of nesting levels the frame adds above the body.
 *
 * @internal
 */
export type KernelFrameBodyPath = readonly (number | string)[];

/**
 * Where every kernel framing value embeds whole record bodies. These mirror the wire shapes of
 * the frames encoded with `canonicalizeKernelFrame`: record identity input
 * (`src/record/envelope.ts`), the append batch idempotency digest (`src/store/codec.ts`, the
 * `AppendBatchDraft` shape), the native trace archive (`src/interchange/export.ts`), and the
 * redacted archive (`src/retention/redacted-archive.ts`). Tests follow each path through a real
 * frame, so a shape change that moves a body deeper fails there instead of silently refusing
 * bodies at the configured bound.
 *
 * @internal
 */
export const KERNEL_FRAME_BODY_PATHS = Object.freeze({
    appendBatchDigest: Object.freeze(["groups", 0, "records", 0, "body"]),
    recordIdentity: Object.freeze(["body"]),
    redactedArchive: Object.freeze(["records", 0, "body"]),
    traceArchive: Object.freeze(["records", 0, "body"]),
} satisfies Readonly<Record<string, KernelFrameBodyPath>>);

/**
 * Smallest `kernel.canonicalization.framingDepth` that admits a record body at
 * `maxNestingDepth` inside every kernel frame: the deepest body location among
 * {@link KERNEL_FRAME_BODY_PATHS}. Protocol configuration validation refuses anything smaller.
 *
 * @internal
 */
export const REQUIRED_KERNEL_FRAMING_DEPTH = Math.max(
    ...Object.values(KERNEL_FRAME_BODY_PATHS).map((path) => path.length),
);
