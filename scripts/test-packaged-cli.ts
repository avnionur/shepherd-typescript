import { testPackagedCli } from "../tooling/testing/packaged-cli.ts";

await testPackagedCli(process.argv.includes("--runtime-boundaries"));
