import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";

import {
    ORPHAN_REPAIR_VERSIONS,
    type OrphanRepairCommand,
    SQLiteTraceStore,
} from "../../src/index.ts";

const diagnosisSchema = readSchema("orphan-operation-diagnosis-v1.schema.json");
const commandSchema = readSchema("orphan-repair-command-v1.schema.json");
const receiptSchema = readSchema("orphan-repair-receipt-v1.schema.json");

test("generated orphan diagnosis, command, and receipt schemas are closed and accept public evidence", () => {
    const validator = new Ajv2020({ strict: true });
    validator.addKeyword("x-shepherd-max-canonical-bytes");
    validator.addKeyword({
        keyword: "x-shepherd-max-utf8-bytes",
        schemaType: "number",
        type: "string",
        validate: (maxBytes: number, value: string) => Buffer.byteLength(value, "utf8") <= maxBytes,
    });
    const validateDiagnosis = validator.compile(diagnosisSchema);
    const validateCommand = validator.compile(commandSchema);
    const validateReceipt = validator.compile(receiptSchema);
    using store = new SQLiteTraceStore();
    store.recordOpenOperation({
        cause_record_id: null,
        operation_id: "operation:schema",
        operation_version: ORPHAN_REPAIR_VERSIONS.operation,
        owner_id: "run:schema",
        provider_call_started: false,
        retained_cause: "schema fixture",
        scope_id: null,
        scope_owned: false,
        session_id: "session:schema",
    });
    store.recordOperationSessionDeath({
        death_evidence_id: "session-lock:schema",
        session_id: "session:schema",
    });
    const diagnosis = store.diagnoseOrphanedOperations();
    const command: OrphanRepairCommand = {
        basis_id: diagnosis.basis_id,
        command_id: "repair:schema",
        command_version: ORPHAN_REPAIR_VERSIONS.command,
        operation_ids: ["operation:schema"],
    };
    const receipt = store.repairOrphanedOperations(command);

    assert.equal(
        validateDiagnosis(diagnosis),
        true,
        validator.errorsText(validateDiagnosis.errors),
    );
    assert.equal(validateCommand(command), true, validator.errorsText(validateCommand.errors));
    assert.equal(validateReceipt(receipt), true, validator.errorsText(validateReceipt.errors));
    assert.equal(validateDiagnosis({ ...diagnosis, extra: true }), false);
    assert.equal(
        validateCommand({ ...command, operation_ids: ["operation:schema", "operation:schema"] }),
        false,
    );
    assert.equal(validateReceipt({ ...receipt, receipt_version: 99 }), false);
    assert.equal(
        validateCommand({
            ...command,
            command_id: "é".repeat(300),
        }),
        false,
    );
    assert.equal(validateDiagnosis({ ...diagnosis, offset: 101 }), false);
});

function readSchema(name: string): AnySchemaObject {
    return JSON.parse(
        readFileSync(new URL(`../../spec/schemas/${name}`, import.meta.url), "utf8"),
    ) as AnySchemaObject;
}
