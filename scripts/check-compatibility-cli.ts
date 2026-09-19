import {
    checkCompatibility,
    updateCompatibilityBaseline,
} from "../tooling/compatibility/policy.ts";

const usage =
    "Usage: check-compatibility-cli.ts --check | --update [--classify <additive|breaking>] [--artifact <id>]... [--note <text>]";
const [mode, ...rest] = process.argv.slice(2);

if (mode === "--check" && rest.length === 0) {
    const report = await checkCompatibility();
    process.stdout.write(
        `compatibility baselines are current (${report.accepted.length} changes)\n`,
    );
} else if (mode === "--update") {
    let classify: "additive" | "breaking" | undefined;
    let note: string | undefined;
    const artifacts: string[] = [];
    for (let index = 0; index < rest.length; index += 2) {
        const [flag, value] = [rest[index], rest[index + 1]];
        if (flag === "--classify" && (value === "additive" || value === "breaking")) {
            classify = value;
        } else if (flag === "--artifact" && value !== undefined && value.length > 0) {
            artifacts.push(value);
        } else if (flag === "--note" && value !== undefined && value.length > 0) {
            note = value;
        } else {
            throw new TypeError(usage);
        }
    }
    const report = await updateCompatibilityBaseline({
        ...(artifacts.length === 0 ? {} : { artifacts }),
        ...(classify === undefined ? {} : { classify }),
        ...(note === undefined ? {} : { note }),
    });
    for (const line of report.accepted) {
        process.stdout.write(`recorded: ${line}\n`);
    }
    process.stdout.write("compatibility baselines updated\n");
} else {
    throw new TypeError(usage);
}
