import { readFileSync } from "node:fs";
import type { KernelProtocolConfig, ProtocolConfig, RecordIdConfig } from "./config-types.ts";
import { parseProtocolConfig } from "./config-validation.ts";
import { RECORD_MODES } from "./values.generated.ts";

/** Location of the protocol configuration relative to this source or built module. */
export const protocolConfigUrl = new URL("../../protocol.config.json", import.meta.url);

const protocolConfig: ProtocolConfig = parseProtocolConfig(
    JSON.parse(readFileSync(protocolConfigUrl, "utf8")),
    { expectedRecordModes: RECORD_MODES },
);

/** Runtime kernel ABI and canonicalization configuration. */
export const kernelProtocolConfig: KernelProtocolConfig = protocolConfig.kernel;

/** Runtime record-identifier configuration loaded from the protocol configuration file. */
export const recordIdConfig: RecordIdConfig = protocolConfig.recordId;
