import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { ROOT_WITNESS_ID, type StoreAppendRequest } from "../../src/index.ts";

/**
 * Synthetic credentials for every configured secret class, assembled at runtime so that no
 * credential-shaped literal appears in the repository.
 */
export const SECRET_SAMPLES: Readonly<Record<string, string>> = Object.freeze({
    "aws-access-key-id": ["AK", "IA", "Z".repeat(16)].join(""),
    "bearer-token": ["Bea", "rer ", "t".repeat(24)].join(""),
    "github-token": ["gh", "p_", "A".repeat(36)].join(""),
    "google-api-key": ["AI", "za", "B".repeat(35)].join(""),
    "pem-private-key": ["-----BEGIN ", "RSA PRIV", "ATE KEY-----"].join(""),
    "provider-api-key": ["sk", "-", "C".repeat(24)].join(""),
    "slack-token": ["xo", "xb-", "1".repeat(12)].join(""),
});

/** Secret-free body text used where a detector must not match. */
export const CLEAN_TEXT = "ordinary retained text";

/** Creates a temporary directory removed after the test. */
export async function temporaryDirectory(context: TestContext, prefix: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    context.after(() => rm(directory, { force: true, recursive: true }));
    return directory;
}

/** Builds a one-record append request under the root witness. */
export function singleRecordRequest(
    appendIntentId: string,
    ownerId: string,
    schemaRef: string,
    body: Readonly<Record<string, unknown>>,
): StoreAppendRequest {
    return {
        append_intent_id: appendIntentId,
        batch: {
            groups: [
                {
                    owner_id: ownerId,
                    records: [
                        {
                            body: body as never,
                            mode: "capture",
                            schema_ref: schemaRef,
                            witness_ref: ROOT_WITNESS_ID,
                        },
                    ],
                },
            ],
        },
    };
}
