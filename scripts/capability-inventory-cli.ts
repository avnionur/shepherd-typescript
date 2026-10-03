import {
    checkCapabilityInventory,
    writeCapabilityInventory,
} from "../tooling/capability-inventory.ts";

const [mode, ...rest] = process.argv.slice(2);
if (rest.length > 0 || (mode !== undefined && mode !== "--check")) {
    throw new TypeError("Usage: capability-inventory-cli.ts [--check]");
}
if (mode === "--check") await checkCapabilityInventory();
else await writeCapabilityInventory();
