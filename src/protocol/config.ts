import { readFileSync } from "node:fs";

type ProtocolConfig = {
    readonly kernel: KernelProtocolConfig;
    readonly recordId: RecordIdConfig;
};

type KernelProtocolConfig = {
    readonly abiVersion: string;
    readonly append: {
        readonly firstOwnerOrdinal: number;
        readonly lastOwnerOrdinal: number;
    };
    readonly canonicalVersion: string;
    readonly recordKind: string;
    readonly recordModes: readonly string[];
    readonly rootWitness: {
        readonly body: Readonly<Record<string, unknown>>;
        readonly mode: string;
        readonly schemaRef: string;
        readonly witnessRef: string;
    };
};

type RecordIdConfig = {
    readonly algorithm: string;
    readonly hexLength: number;
    readonly prefix: string;
};

/** Location of the protocol configuration relative to this source or built module. */
export const protocolConfigUrl = new URL("../../protocol.config.json", import.meta.url);

const protocolConfig = JSON.parse(readFileSync(protocolConfigUrl, "utf8")) as ProtocolConfig;

/** Runtime kernel ABI and canonicalization configuration. */
export const kernelProtocolConfig: KernelProtocolConfig = protocolConfig.kernel;

/** Runtime record-identifier configuration loaded from the protocol configuration file. */
export const recordIdConfig: RecordIdConfig = protocolConfig.recordId;
