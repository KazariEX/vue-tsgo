import { Clerc, helpPlugin, versionPlugin } from "clerc";
import { join, resolve } from "pathe";
import { find } from "tsconfck";
import packageJson from "../../package.json";
import { createProject } from "../core/project";
import { runTsgoCommand } from "../core/shared";

async function main() {
    const { stdout: tsgoHelpText } = await runTsgoCommand(
        process.cwd(),
        ["--help"],
    );

    const footer = "-".repeat(40) + `\n` + tsgoHelpText;

    await Clerc.create()
        .use(versionPlugin())
        .use(helpPlugin({ command: false, footer }))
        .name("Vue Tsgo")
        .scriptName("vue-tsgo")
        .description(packageJson.description)
        .version(packageJson.version)
        .command("", {
            flags: {
                project: {
                    type: String,
                    short: "p",
                    description: "Path to tsconfig.json file",
                },
            },
        })
        .on("", async (context) => {
            let configPath = context.flags.project;
            if (configPath !== void 0) {
                configPath = resolve(configPath);
            }
            else {
                const fileName = join(process.cwd(), "dummy.ts");
                configPath = await find(fileName) ?? void 0;
            }

            if (configPath === void 0) {
                console.error("[Vue] Could not find a tsconfig.json file.");
                process.exit(1);
            }

            const project = await createProject(configPath);
            await project.runTsgo();
        })
        .parse();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
