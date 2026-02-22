#!/usr/bin/env node
import { Clerc, defineCommand, helpPlugin, versionPlugin } from "clerc";
import { join, resolve } from "pathe";
import { find } from "tsconfck";
import packageJson from "../../package.json";
import { createProject } from "../core/project";
import { runTsgoCommand } from "../core/shared";

const tsgo = defineCommand({
    name: "",
    description: packageJson.description,
    flags: {
        build: {
            type: String,
            short: "b",
            help: {
                show: false,
            },
        },
        project: {
            type: String,
            short: "p",
            help: {
                show: false,
            },
        },
        pretty: {
            type: Boolean,
            help: {
                show: false,
            },
        },
    },
}, async (context) => {
    let configPath = context.flags.build ?? context.flags.project;
    if (configPath) {
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
    await project.runTsgo(
        context.flags.build !== void 0 ? "build" : "project",
        context.rawParsed.rawUnknown,
    );
});

await Clerc.create()
    .use(helpPlugin({
        command: false,
        async footer() {
            console.log();
            console.log("-".repeat(45));
            console.log();

            await runTsgoCommand(["--help"], {
                nodeOptions: {
                    // use the same stdio as the current process
                    // to ensure the help text is well formatted in the terminal
                    stdio: "inherit",
                },
            });
        },
    }))
    .use(versionPlugin({
        command: false,
    }))
    .name("Vue Tsgo")
    .scriptName("vue-tsgo")
    .description(packageJson.description)
    .version(packageJson.version)
    .command(tsgo)
    .parse();
