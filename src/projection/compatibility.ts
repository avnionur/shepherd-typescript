import { projectionProtocolConfig } from "../protocol/config.ts";
import { ProjectionCompatibilityError } from "../store/errors.ts";
import type { ModeFilter, Slice, SliceReadOptions, VisibilityProfile } from "../store/types.ts";

/** Verifies that a slice exposes the modes and payload required by execution projections. */
export function assertHistoryProjectionCompatible(slice: Slice): void {
    const config = projectionProtocolConfig.executionHistory;
    if (
        slice.mode_filter !== config.modeRequirement ||
        !config.payloadVisibilityProfiles.includes(slice.visibility_profile)
    ) {
        throw new ProjectionCompatibilityError(
            "execution projection requires a payload-visible slice with the configured mode",
        );
    }
}

/** Returns the configured store-read options required by execution-history projections. */
export function historyProjectionReadOptions(): Required<SliceReadOptions> {
    const config = projectionProtocolConfig.executionHistory;
    return Object.freeze({
        mode_filter: config.modeRequirement as ModeFilter,
        visibility_profile: config.payloadVisibilityProfiles[0] as VisibilityProfile,
    });
}
