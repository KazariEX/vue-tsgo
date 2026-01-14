import { readFileSync } from "node:fs";
import { posix as path } from "node:path";
import { getDefaultCompilerOptions, type RawVueCompilerOptions, type VueCompilerOptions, type VueLanguagePlugin } from "@vue/language-core";
import { camelize } from "@vue/shared";
import resolver from "oxc-resolver";
import { hyphenateTag } from "./shared";

const syntaxRE = /^\s*@(?<key>\w+)\b(?<value>.+)/m;

export function parseLocalCompilerOptions(comments: string[]) {
    // eslint-disable-next-line array-callback-return
    const entries = comments.map((text) => {
        try {
            const match = syntaxRE.exec(text);
            if (match) {
                const { key, value } = match.groups!;
                return [key, JSON.parse(value)];
            }
        }
        catch {}
    }).filter((item) => !!item);

    if (entries.length) {
        return Object.fromEntries(entries) as RawVueCompilerOptions;
    }
}

export function createCompilerOptionsResolver() {
    const resolved: Omit<RawVueCompilerOptions, "target" | "strictTemplates" | "typesRoot" | "plugins"> = {};
    const plugins: VueLanguagePlugin[] = [];
    let target: number | undefined;
    let typesRoot: string | undefined;

    function add(options: RawVueCompilerOptions, rootDir: string) {
        for (const key in options) {
            switch (key) {
                case "target": {
                    if (options[key] === "auto") {
                        target = resolveVueVersion(rootDir);
                    }
                    else {
                        target = options[key];
                    }
                    break;
                }
                case "strictTemplates": {
                    const strict = !!options[key];
                    resolved.strictVModel ??= strict;
                    resolved.checkUnknownProps ??= strict;
                    resolved.checkUnknownEvents ??= strict;
                    resolved.checkUnknownDirectives ??= strict;
                    resolved.checkUnknownComponents ??= strict;
                    break;
                }
                case "typesRoot": {
                    if (options[key] !== void 0) {
                        if (path.isAbsolute(options[key])) {
                            typesRoot = options[key];
                        }
                        else {
                            typesRoot = path.join(rootDir, options[key]);
                        }
                    }
                    break;
                }
                case "plugins": {
                    for (const pluginPath of options.plugins ?? []) {
                        try {
                            const resolve = (require as NodeJS.Require | undefined)?.resolve;
                            const resolvedPath = resolve?.(pluginPath, { paths: [rootDir] });
                            if (resolvedPath) {
                                // eslint-disable-next-line ts/no-require-imports
                                const plugin = require(resolvedPath);
                                plugin.__moduleName = pluginPath;
                                plugins.push(plugin);
                            }
                            else {
                                console.warn("[Vue] Load plugin failed:", pluginPath);
                            }
                        }
                        catch (error) {
                            console.warn("[Vue] Resolve plugin path failed:", pluginPath, error);
                        }
                    }
                }
                default: {
                    // @ts-expect-error ...
                    resolved[key] = options[key];
                    break;
                }
            }
        }

        if (options.target === void 0) {
            target ??= resolveVueVersion(rootDir);
        }
    }

    function resolve(defaults = getDefaultCompilerOptions(
        target,
        resolved.lib,
        void 0,
        typesRoot,
    )): VueCompilerOptions {
        return {
            ...defaults,
            ...resolved,
            plugins,
            macros: {
                ...defaults.macros,
                ...resolved.macros,
            },
            composables: {
                ...defaults.composables,
                ...resolved.composables,
            },
            fallthroughComponentNames: [
                ...defaults.fallthroughComponentNames,
                ...resolved.fallthroughComponentNames ?? [],
            ].map(hyphenateTag),
            experimentalModelPropName: Object.fromEntries(
                Object.entries(
                    resolved.experimentalModelPropName ?? defaults.experimentalModelPropName,
                ).map(([k, v]) => [camelize(k), v]),
            ),
        };
    }

    return {
        add,
        resolve,
    };
}

function resolveVueVersion(folder: string) {
    const { packageJsonPath } = resolver.sync(folder, "vue/package.json");
    if (packageJsonPath === void 0) {
        return;
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const version = packageJson.version as string;
    const [major, minor] = version.split(".");
    return Number(major + "." + minor);
}
