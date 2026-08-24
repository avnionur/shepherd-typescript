/** Injectable process boundary used by the reusable CLI runner. */
export type CliIo = {
    /** Current working directory used to resolve configured relative paths. */
    readonly cwd: string;
    /** Bounded standard-error sink. */
    readonly stderr: (text: string) => void;
    /** Bounded standard-output sink. */
    readonly stdout: (text: string) => void;
};

/** @internal Bounded normalized I/O presented to command handlers. */
export type CliHandlerIo = {
    readonly cwd: string;
    readonly error: (text: string) => void;
    readonly output: (text: string) => void;
};

/** @internal Asynchronous configured command handler. */
export type CliHandler = (args: readonly string[], io: CliHandlerIo) => Promise<void>;
