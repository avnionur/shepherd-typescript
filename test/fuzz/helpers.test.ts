import { registerFuzzTests } from "./suite.ts";
import { HELPER_TARGETS } from "./targets/helpers.ts";
import { SKIPPED_TARGETS } from "./targets/index.ts";
import { PROVIDER_TARGETS } from "./targets/providers.ts";

registerFuzzTests([...HELPER_TARGETS, ...PROVIDER_TARGETS, ...SKIPPED_TARGETS]);
