import type { AppendBatchDraft } from "../append/types.ts";
import { effectProtocolConfig } from "../protocol/config.ts";
import { TraceStoreError } from "./errors.ts";

/**
 * Refuses a general append to an owner path reserved for effect compensation.
 *
 * Compensation paths are written only by head-compared compensation transactions, so a raw append
 * cannot forge a compensated outcome that would suppress a required compensation.
 *
 * @internal
 */
export function assertUnreservedCompensationOwners(batch: AppendBatchDraft): void {
    for (const group of batch.groups) {
        assertUnreservedCompensationOwner(group.owner_id);
    }
}

/** Refuses one owner path reserved for effect compensation. @internal */
export function assertUnreservedCompensationOwner(ownerId: string): void {
    if (ownerId.startsWith(effectProtocolConfig.compensation.identity.compensationIdPrefix)) {
        throw new TraceStoreError(`owner path ${ownerId} is reserved for effect compensation`);
    }
}
