#!/usr/bin/env node
import { Cli, defineCommand } from "clerc";
import { join, resolve } from "pathe";
import { find } from "tsconfck";
import packageJson from "../../package.json";
import { createProject } from "../core/project";

const tsgo = defineCommand({
    name: "",
    flags: {
        build: {
            type: String,
            short: "b",
        },
        project: {
            type: String,
            short: "p",
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

await Cli()
    .name("Vue Tsgo")
    .scriptName("vue-tsgo")
    .description(packageJson.description)
    .version(packageJson.version)
    .command(tsgo)
    .parse();
