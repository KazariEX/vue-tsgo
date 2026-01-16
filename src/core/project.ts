import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { stripVTControlCharacters, styleText } from "node:util";
import * as pkg from "empathic/package";
import { detectPackageManager } from "nypm";
import { ResolverFactory } from "oxc-resolver";
import { dirname, join, relative, resolve } from "pathe";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { parse } from "tsconfck";
import { $ } from "zx";
import type { TSConfig } from "pkg-types";
import packageJson from "../../package.json";
import { createSourceFile, type SourceFile } from "./codegen";
import { createCompilerOptionsBuilder } from "./compilerOptions";
import type { CodeInformation } from "./types";

export interface Project {
    check: () => Promise<boolean>;
}

export async function createProject(configPath: string): Promise<Project> {
    const configRoot = dirname(configPath);
    const configHash = createHash("sha256").update(configPath).digest("hex").slice(0, 8);

    const cacheRoot = pkg.cache(`${packageJson.name}/${configHash}`, {
        cwd: configRoot,
    })!;
    if (cacheRoot === void 0) {
        throw new Error("[Vue] Failed to find a cache directory.");
    }

    const parsed = await parse(configPath);
    const builder = createCompilerOptionsBuilder();
    const resolver = new ResolverFactory({
        tsconfig: {
            configFile: configPath,
        },
        extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts", ".json", ".vue"],
    });

    for (const extended of parsed.extended?.toReversed() ?? []) {
        if ("vueCompilerOptions" in extended.tsconfig) {
            builder.add(extended.tsconfig.vueCompilerOptions, dirname(extended.tsconfigFile));
        }
    }
    const vueCompilerOptions = builder.build();

    const includes = await resolveFiles(parsed.tsconfig, configRoot);
    const sourceToFiles = new Map<string, SourceFile>();
    const targetToFiles = new Map<string, SourceFile>();

    for (const path of includes) {
        if (sourceToFiles.has(path)) {
            continue;
        }

        const sourceText = await readFile(path, "utf-8").catch(() => void 0);
        if (sourceText === void 0) {
            includes.delete(path);
            continue;
        }

        const sourceFile = createSourceFile(path, sourceText, vueCompilerOptions);
        sourceToFiles.set(path, sourceFile);

        for (const specifier of [
            ...sourceFile.imports,
            ...sourceFile.references.map((reference) => join(dirname(path), reference)),
        ]) {
            const result = await resolver.resolveFileAsync(path, specifier);
            if (result?.path === void 0 || result.path.includes("/node_modules/")) {
                continue;
            }
            includes.add(result.path);
        }
    }

    const mutualRoot = getMutualRoot(includes, configRoot);
    const toSourcePath = (path: string) => join(mutualRoot, relative(cacheRoot, path));
    const toTargetPath = (path: string) => join(cacheRoot, relative(mutualRoot, path));
    // avoid parsing errors for TS specific syntax in JS files
    const toTargetLang = (lang: string) => (lang === "js" ? "ts" : lang === "jsx" ? "tsx" : lang);

    for (const path of includes) {
        const sourceFile = sourceToFiles.get(path)!;
        const targetPath = sourceFile.type === "virtual"
            ? toTargetPath(path) + "." + toTargetLang(sourceFile.virtualLang)
            : toTargetPath(path);
        targetToFiles.set(targetPath, sourceFile);
    }

    async function generate() {
        await rm(cacheRoot, { recursive: true, force: true });
        const tasks: (() => Promise<void>)[] = [];

        for (const path of includes) {
            tasks.push(async () => {
                const sourceFile = sourceToFiles.get(path)!;
                const targetPath = sourceFile.type === "virtual"
                    ? toTargetPath(path) + "." + toTargetLang(sourceFile.virtualLang)
                    : toTargetPath(path);

                await mkdir(dirname(targetPath), { recursive: true });
                await writeFile(
                    targetPath,
                    sourceFile.type === "virtual" ? sourceFile.virtualText : sourceFile.sourceText,
                );
            });
        }

        tasks.push(async () => {
            const types: string[] = ["template-helpers.d.ts"];
            if (!vueCompilerOptions.checkUnknownProps) {
                types.push("props-fallback.d.ts");
            }
            if (vueCompilerOptions.lib === "vue" && vueCompilerOptions.target < 3.5) {
                types.push("vue-3.4-shims.d.ts");
            }

            const targetConfigPath = toTargetPath(configPath);
            const targetConfig: TSConfig = {
                ...parsed.tsconfig,
                compilerOptions: {
                    ...parsed.tsconfig.compilerOptions,
                    types: [
                        ...parsed.tsconfig.compilerOptions?.types ?? [],
                        ...types.map((name) => join(vueCompilerOptions.typesRoot, name)),
                    ],
                },
                extends: void 0,
            };

            await mkdir(dirname(targetConfigPath), { recursive: true });
            await writeFile(targetConfigPath, JSON.stringify(targetConfig, null, 2));
        });

        for (const name of ["package.json", "node_modules"]) {
            tasks.push(async () => {
                const path = join(mutualRoot, name);
                await symlink(path, toTargetPath(path)).catch(() => void 0);
            });
        }

        await Promise.all(tasks.map((task) => task()));
    }

    async function check() {
        await generate();
        const packageManager = await detectPackageManager(configRoot);
        const command = !packageManager || packageManager.name === "npm" ? "npx" : packageManager.name;

        const targetConfigPath = toTargetPath(configPath);
        const { stdout } = await $({ nothrow: true })`
            ${command} tsgo --project ${targetConfigPath} --pretty true
        `;

        const groups = parseDiagnostics(stripVTControlCharacters(stdout));
        const stats: { path: string; line: number; count: number }[] = [];

        for (const [originalPath, diagnostics] of Object.entries(groups)) {
            const sourceFile = targetToFiles.get(originalPath);
            let sourcePath = sourceFile?.sourcePath;

            outer: for (let i = 0; i < diagnostics.length; i++) {
                const diagnostic = diagnostics[i];

                if (!sourceFile || sourceFile.type === "native") {
                    if (originalPath.startsWith(cacheRoot)) {
                        sourcePath ??= toSourcePath(originalPath);
                    }
                    continue;
                }

                // eslint-disable-next-line no-unreachable-loop
                for (const [start, end] of sourceFile.mapper.toSourceRange(
                    sourceFile.getVirtualOffset(
                        diagnostic.start.line,
                        diagnostic.start.column,
                    ),
                    sourceFile.getVirtualOffset(
                        diagnostic.end.line,
                        diagnostic.end.column,
                    ),
                    true,
                    (data) => isVerificationEnabled(data, diagnostic.code),
                )) {
                    diagnostic.start = sourceFile.getSourceLineAndColumn(start);
                    diagnostic.end = sourceFile.getSourceLineAndColumn(end);
                    continue outer;
                }

                diagnostics.splice(i--, 1);
            }

            const relativePath = relative(process.cwd(), sourcePath!);
            const sourceText = sourceFile?.sourceText ?? await readFile(originalPath, "utf-8");
            const lines = sourceText.split("\n");

            for (const { start, end, code, message } of diagnostics) {
                console.info(`${styleText("cyanBright", relativePath)}:${styleText("yellowBright", String(start.line))}:${styleText("yellowBright", String(start.column))} - ${styleText("redBright", "error")} ${styleText("gray", `TS${code}:`)} ${message}\n`);

                const padding = String(end.line).length;
                const printedLines = lines.slice(start.line - 1, end.line);

                for (let i = 0; i < printedLines.length; i++) {
                    const line = printedLines[i];
                    const columnStart = i === 0 ? start.column - 1 : 0;
                    const columnEnd = i === printedLines.length - 1 ? end.column - 1 : line.length;

                    console.info(`\x1B[7m${start.line + i}\x1B[0m ${line}`);
                    console.info(`\x1B[7m${" ".repeat(padding)}\x1B[0m ${" ".repeat(columnStart)}${styleText("redBright", "~".repeat(columnEnd - columnStart))}\n`);
                }
            }

            if (diagnostics.length) {
                stats.push({
                    path: relativePath,
                    line: diagnostics[0].start.line,
                    count: diagnostics.length,
                });
            }
            else {
                delete groups[originalPath];
            }
        }

        if (stats.length === 1) {
            const { path, line, count } = stats[0];
            console.info(`\nFound ${count} error${count > 1 ? "s" : ""} in the same file, starting at: ${path}${styleText("gray", `:${line}`)}\n`);
        }
        else if (stats.length > 1) {
            const total = stats.reduce((prev, curr) => prev + curr.count, 0);
            console.info(`\nFound ${total} errors in ${stats.length} files.\n`);
            console.info(`Errors  Files`);
            for (const { path, line, count } of stats) {
                console.info(`${String(count).padStart(6)}  ${path}${styleText("gray", `:${line}`)}`);
            }
            console.info(``);
        }
        return stats.length === 0;
    }

    return {
        check,
    };
}

async function resolveFiles(config: TSConfig, configRoot: string) {
    const includes = await Promise.all(
        config.include?.map(async (pattern) => {
            const originalKey = pattern;

            if (!pattern.includes("*")) {
                pattern = await transformPattern(pattern);
                if (originalKey === pattern) {
                    return join(configRoot, pattern);
                }
            }

            return glob(pattern, {
                absolute: true,
                cwd: configRoot,
                ignore: "**/node_modules/**",
            });
        }) ?? [],
    );

    const excludes = await Promise.all(
        config.exclude?.map(async (pattern) => picomatch(
            join(configRoot, pattern.includes("*") ? pattern : await transformPattern(pattern)),
        )) ?? [],
    );

    return new Set(
        includes.flat().filter((path) => excludes.every((match) => !match(path))),
    );

    async function transformPattern(pattern: string) {
        try {
            const path = join(configRoot, pattern);
            const stats = await stat(path);
            if (stats.isFile()) {
                return pattern;
            }
        }
        catch {}
        return join(pattern, "**/*");
    }
}

function getMutualRoot(includes: Set<string>, configRoot: string) {
    let mutual: string[] = configRoot.split("/");

    for (const path of includes) {
        const segment = path.split("/");
        for (let i = 0; i < mutual.length; i++) {
            if (mutual[i] !== segment[i]) {
                mutual = mutual.slice(0, i);
                break;
            }
        }
    }
    return mutual.join("/");
}

function isVerificationEnabled(data: CodeInformation, code: number) {
    return data.verification === true ||
        typeof data.verification === "object" &&
        data.verification.shouldReport?.(code) === true;
}

interface Diagnostic {
    path: string;
    start: {
        line: number;
        column: number;
    };
    end: {
        line: number;
        column: number;
    };
    code: number;
    message: string;
}

const diagnosticRE = /^(?<path>.*?):(?<line>\d+):(?<column>\d+) - error TS(?<code>\d+): (?<message>.*)$/;

function parseDiagnostics(stdout: string) {
    const diagnostics: Diagnostic[] = [];
    const lines = stdout.trim().split("\n");

    let cursor = 0;
    let padding = 0;

    for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        const match = text.match(diagnosticRE);

        if (match) {
            const { path, line, column, code, message } = match.groups!;
            diagnostics.push({
                path: resolve(path),
                code: Number(code),
                start: {
                    line: Number(line),
                    column: Number(column),
                },
                end: {
                    line: 0,
                    column: 0,
                },
                message,
            });
            cursor = 0;
        }
        else if (cursor % 2 === 0 && text.length) {
            padding = text.split(" ", 1)[0].length;
        }
        else if (cursor % 2 === 1 && text.includes("~")) {
            const diagnostic = diagnostics.at(-1)!;
            diagnostic.end = {
                line: diagnostic.start.line + (cursor - 3) / 2,
                column: text.lastIndexOf("~") + 1 - padding,
            };
        }
        else if (text.startsWith("Found")) {
            break;
        }
        cursor++;
    }

    const groups: Record<string, typeof diagnostics> = {};
    for (const diagnostic of diagnostics) {
        (groups[diagnostic.path] ??= []).push(diagnostic);
    }
    return groups;
}
