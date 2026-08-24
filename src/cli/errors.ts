/** @internal Stable usage refusal before command execution. */
export class CliUsageError extends Error {}

/** @internal Honest refusal for a configured but unavailable command capability. */
export class CliUnavailableError extends Error {}
