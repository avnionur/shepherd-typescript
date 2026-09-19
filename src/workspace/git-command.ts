import { workspaceProtocolConfig } from "../protocol/config.ts";

/**
 * Builds the argument vector for one Git subprocess rooted at `root`.
 *
 * Every configured `workspaces.gitInvocation.configOverrides` entry is passed as `-c key=value`
 * before `-C root` and the subcommand, so repository configuration such as `core.fsmonitor`
 * cannot select helper programs for plumbing reads.
 *
 * @internal
 */
export function gitCommandArguments(root: string, args: readonly string[]): string[] {
    return [
        ...workspaceProtocolConfig.gitInvocation.configOverrides.flatMap((entry) => ["-c", entry]),
        "-C",
        root,
        ...args,
    ];
}

/**
 * Builds the environment for one Git subprocess from the current process environment.
 *
 * Variables whose names start with a configured prefix (by default every `GIT_*` variable, such
 * as `GIT_DIR`, `GIT_CONFIG_PARAMETERS`, or `GIT_EXTERNAL_DIFF`) are removed so the caller's
 * environment cannot redirect the repository or inject configuration; configured variables are
 * then set.
 *
 * @internal
 */
export function gitCommandEnvironment(): Record<string, string> {
    const invocation = workspaceProtocolConfig.gitInvocation;
    // Enumerated process.env entries always carry string values.
    const inherited = Object.fromEntries(
        Object.entries(process.env).filter(
            ([name]) =>
                !invocation.removedEnvironmentPrefixes.some((prefix) => name.startsWith(prefix)),
        ),
    ) as Record<string, string>;
    return { ...inherited, ...invocation.environment };
}
