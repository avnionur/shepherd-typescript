import { assertNonEmptyString } from "../record/guards.ts";
import type { StoreAppendRequest } from "./types.ts";

const requestKeys = new Set(["append_intent_id", "batch"]);

/** Creates a descriptor-safe append request containing only declared fields. */
export function normalizeStoreAppendRequest(value: unknown): StoreAppendRequest {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("store append request must be a plain object");
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("store append request must be a plain object");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError("store append request must not contain symbol properties");
    }

    const fields = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!requestKeys.has(key)) {
            throw new TypeError(`store append request contains unsupported field: ${key}`);
        }
        if (!("value" in descriptor)) {
            throw new TypeError(`store append request ${key} must not be an accessor property`);
        }
        fields[key] = descriptor.value;
    }
    if (!Object.hasOwn(fields, "append_intent_id") || !Object.hasOwn(fields, "batch")) {
        throw new TypeError("store append request requires append_intent_id and batch");
    }
    assertNonEmptyString(fields.append_intent_id, "append_intent_id");
    return {
        append_intent_id: fields.append_intent_id,
        batch: fields.batch as StoreAppendRequest["batch"],
    };
}
