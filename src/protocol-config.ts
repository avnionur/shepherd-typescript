import { readFileSync } from "node:fs";

type ProtocolConfig = {
    readonly recordId: RecordIdConfig;
};

type RecordIdConfig = {
    readonly algorithm: string;
    readonly prefix: string;
};

/** Location of the protocol configuration relative to this source or built module. */
export const protocolConfigUrl = new URL("../protocol.config.json", import.meta.url);

const protocolConfig = JSON.parse(readFileSync(protocolConfigUrl, "utf8")) as ProtocolConfig;

/** Runtime record-identifier configuration loaded from the protocol configuration file. */
export const recordIdConfig: RecordIdConfig = protocolConfig.recordId;
