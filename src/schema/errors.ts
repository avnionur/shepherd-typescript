import { publicErrorCodes } from "../errors/public-errors.ts";

/** One path-level reason a value does not satisfy a schema. */
export type JSONSchemaIssue = {
    /** Keyword that refused the value, such as `type`, `required`, or `oneOf`. */
    readonly keyword: string;
    /** Human-readable reason, phrased as a predicate on the value at `path`. */
    readonly message: string;
    /** Location of the refused value, rooted at `$`, with `.name` or `["name"]` and `[index]`. */
    readonly path: string;
    /** JSON Pointer fragment of the refusing keyword inside the schema, rooted at `#`. */
    readonly schemaPath: string;
};

/**
 * Raised when a value does not satisfy a task schema or a compiled JSON Schema document.
 *
 * The error is a `TypeError`, the documented class for invalid input, with the configured
 * `SCHEMA_VALIDATION_FAILED` code and the complete list of path-level issues. The message joins
 * every issue as `<path> <message>`, optionally prefixed by a subject; it never embeds the refused
 * value itself.
 *
 * @example
 * ```ts
 * try {
 *     validator.parse(untrusted);
 * } catch (error) {
 *     if (error instanceof JSONSchemaValidationError) {
 *         for (const issue of error.issues) console.error(issue.path, issue.message);
 *     }
 * }
 * ```
 *
 * @public
 */
export class JSONSchemaValidationError extends TypeError {
    /** Stable configured machine-readable schema-validation code. */
    readonly code = publicErrorCodes.schemas.validation;
    /** Every issue found, in document order; never empty. */
    readonly issues: readonly JSONSchemaIssue[];

    /**
     * Creates a validation refusal.
     *
     * @param issues - Non-empty path-level issues.
     * @param subject - Optional description of the validated value prefixed to the message.
     * @param options - Optional in-memory cause retained for diagnostics.
     */
    constructor(issues: readonly JSONSchemaIssue[], subject?: string, options?: ErrorOptions) {
        const detail = issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
        super(subject === undefined ? detail : `${subject}: ${detail}`, options);
        this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
    }
}
