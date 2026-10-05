import {
    readAbsoluteUrl,
    readNonEmptyString,
    readObject,
    readPositiveInteger,
} from "./config-value-readers.ts";

/** Immutable conversation checkpoint format and operational bounds. */
export type ProviderCheckpointProtocolConfig = {
    /** Wire compatibility namespace. */
    readonly compatibilityVersion: string;
    /** Wire body version. */
    readonly recordVersion: number;
    /** Published JSON schema identifier. */
    readonly schemaId: string;
    /** Generated schema destination. */
    readonly schemaPath: string;
    /** Content-addressed receipt prefix. */
    readonly receiptIdPrefix: string;
    /** Private context-channel name prefix. */
    readonly channelPrefix: string;
    /** Content-addressed append intent discriminator. */
    readonly appendIntentKind: string;
    /** Prefix of credential-free configuration digests. */
    readonly configurationIdPrefix: string;
    /** Snapshot resource bounds. */
    readonly limits: {
        /** Maximum identity text bytes. */
        readonly maxIdentityBytes: number;
        /** Maximum retained message count. */
        readonly maxMessages: number;
        /** Maximum offered tool definitions. */
        readonly maxTools: number;
    };
};

/** Reads the closed provider-checkpoint contract. @internal */
export function readProviderCheckpointConfig(value: unknown): ProviderCheckpointProtocolConfig {
    const fields = readObject(
        value,
        [
            "compatibilityVersion",
            "recordVersion",
            "schemaId",
            "schemaPath",
            "receiptIdPrefix",
            "channelPrefix",
            "appendIntentKind",
            "configurationIdPrefix",
            "limits",
        ],
        "providers.conversation.checkpoint",
    );
    const limits = readObject(
        fields.limits,
        ["maxIdentityBytes", "maxMessages", "maxTools"],
        "provider checkpoint limits",
    );
    return {
        compatibilityVersion: readNonEmptyString(
            fields.compatibilityVersion,
            "provider checkpoint compatibility",
        ),
        recordVersion: readPositiveInteger(fields.recordVersion, "provider checkpoint version"),
        schemaId: readAbsoluteUrl(fields.schemaId, "provider checkpoint schema id"),
        schemaPath: readNonEmptyString(fields.schemaPath, "provider checkpoint schema path"),
        receiptIdPrefix: readNonEmptyString(
            fields.receiptIdPrefix,
            "provider checkpoint receipt prefix",
        ),
        channelPrefix: readNonEmptyString(fields.channelPrefix, "provider checkpoint owner prefix"),
        appendIntentKind: readNonEmptyString(
            fields.appendIntentKind,
            "provider checkpoint append kind",
        ),
        configurationIdPrefix: readNonEmptyString(
            fields.configurationIdPrefix,
            "provider checkpoint configuration prefix",
        ),
        limits: {
            maxIdentityBytes: readPositiveInteger(
                limits.maxIdentityBytes,
                "provider checkpoint identity bound",
            ),
            maxMessages: readPositiveInteger(
                limits.maxMessages,
                "provider checkpoint message bound",
            ),
            maxTools: readPositiveInteger(limits.maxTools, "provider checkpoint tool bound"),
        },
    };
}
