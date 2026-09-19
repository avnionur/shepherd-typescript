import type { FuzzTarget } from "../harness.ts";
import { ARCHIVE_TARGETS } from "./archives.ts";
import { CLI_TARGETS } from "./cli.ts";
import { HELPER_TARGETS } from "./helpers.ts";
import { PROVIDER_TARGETS } from "./providers.ts";
import { RECORD_TARGETS } from "./records.ts";
import { WORKSPACE_TARGETS } from "./workspace.ts";

/** Configured targets without a decoder to fuzz; their configuration carries the skip reason. */
export const SKIPPED_TARGETS: readonly FuzzTarget[] = [
    {
        name: "telemetryBatch",
        prepare: async () => ({ skip: "no telemetry decoder exists" }),
    },
];

/** Every fuzz target, in configuration order of the documentation table. */
export const FUZZ_TARGETS: readonly FuzzTarget[] = [
    ...RECORD_TARGETS,
    ...ARCHIVE_TARGETS,
    ...CLI_TARGETS,
    ...WORKSPACE_TARGETS,
    ...HELPER_TARGETS,
    ...PROVIDER_TARGETS,
    ...SKIPPED_TARGETS,
];
