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
import packageJson from "../../package.json";
import { createSourceFile, type SourceFile } from "./codegen";
import { createCompilerOptionsBuilder } from "./compilerOptions";
import type { CodeInformation } from "./types";

export interface Project {
    getSourceFile: (fileName: string) => SourceFile | undefined;
    check: () => Promise<boolean>;
}

export async function createProject(configPath: string): Promise<Project> {
    const parsed = await parse(configPath);
    const configRoot = dirname(configPath);
    const configHash = createHash("sha256").update(configPath).digest("hex").slice(0, 8);

    const cacheRoot = pkg.cache(`${packageJson.name}/${configHash}`, {
        cwd: configRoot,
    })!;
    if (cacheRoot === void 0) {
        throw new Error("[Vue] Failed to find a cache directory.");
    }

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
    const sourceToFileMap = new Map<string, SourceFile>();
    const targetToFileMap = new Map<string, SourceFile>();

    const includes = await resolveFiles(parsed.tsconfig, configRoot);
    const includeSet = new Set(Object.values(includes).flat());
    const mutualRoot = getMutualRoot(Object.keys(includes), configRoot);
    const toTargetPath = (path: string) => join(cacheRoot, relative(mutualRoot, path));

    for (const path of includeSet) {
        if (sourceToFileMap.has(path)) {
            continue;
        }

        const sourceText = await readFile(path, "utf-8");
        const sourceFile = createSourceFile(path, toTargetPath(path), sourceText, vueCompilerOptions);
        sourceToFileMap.set(path, sourceFile);
        targetToFileMap.set(sourceFile.targetPath, sourceFile);

        for (const specifier of [
            ...sourceFile.imports.map((range) => sourceText.slice(range.start + 1, range.end - 1)),
            ...sourceFile.references.map((reference) => join(dirname(path), reference)),
        ]) {
            const result = await resolver.resolveFileAsync(path, specifier);
            if (result?.path === void 0 || result.path.includes("/node_modules/")) {
                continue;
            }
            try {
                const stats = await stat(result.path);
                if (stats.isFile()) {
                    includeSet.add(result.path);
                }
            }
            catch {}
        }
    }

    function getSourceFile(fileName: string) {
        return sourceToFileMap.get(fileName);
    }

    async function generate() {
        await rm(cacheRoot, { recursive: true, force: true });
        await mkdir(cacheRoot, { recursive: true });

        for (const path of includeSet) {
            const sourceFile = getSourceFile(path)!;
            await mkdir(dirname(sourceFile.targetPath), { recursive: true });
            await writeFile(sourceFile.targetPath, sourceFile.virtualText ?? sourceFile.sourceText);
        }

        const targetConfigPath = toTargetPath(configPath);
        const targetConfig = {
            ...parsed.tsconfig,
            extends: void 0,
        };
        await mkdir(dirname(targetConfigPath), { recursive: true });
        await writeFile(targetConfigPath, JSON.stringify(targetConfig, null, 2));

        if (dirname(targetConfigPath) !== cacheRoot) {
            const stubConfigPath = join(cacheRoot, "tsconfig.json");
            const stubConfig = {
                references: [{ path: "./" + relative(cacheRoot, targetConfigPath) }],
                files: [],
            };
            await writeFile(stubConfigPath, JSON.stringify(stubConfig, null, 2));
        }

        for (const path of [
            join(mutualRoot, "package.json"),
            join(mutualRoot, "node_modules"),
        ]) {
            try {
                await symlink(path, toTargetPath(path));
            }
            catch {}
        }
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
        let withoutError = true;

        for (let [path, diagnostics] of Object.entries(groups)) {
            const sourceFile = targetToFileMap.get(path);

            outer: for (let i = 0; i < diagnostics.length; i++) {
                const diagnostic = diagnostics[i];

                if (!sourceFile || sourceFile.virtualText === void 0) {
                    if (path.startsWith(cacheRoot)) {
                        path = path.replace(cacheRoot, mutualRoot);
                    }
                    continue;
                }
                path = sourceFile.sourcePath;

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

            const relativePath = relative(process.cwd(), path);
            const sourceText = sourceFile?.sourceText ?? await readFile(path, "utf-8");
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
                withoutError = false;
            }
        }

        return withoutError;
    }

    return {
        getSourceFile,
        check,
    };
}

async function resolveFiles(config: any, configRoot: string) {
    const excludes = await Promise.all(
        config.exclude?.map(async (pattern: string) => (
            join(configRoot, pattern.includes("*") ? pattern : await transformPattern(pattern))
        )),
    );

    return Object.fromEntries<string[]>(
        await Promise.all(config.include?.map(resolve)),
    );

    async function resolve(pattern: string) {
        const originalKey = pattern;
        let files: string[];

        if (!pattern.includes("*")) {
            pattern = await transformPattern(pattern);
            if (originalKey === pattern) {
                files = [join(configRoot, pattern)];
            }
        }

        files ??= await glob(pattern, {
            absolute: true,
            cwd: configRoot,
            ignore: "**/node_modules/**",
        });

        return [originalKey, files.filter(filter)];
    }

    function filter(path: string) {
        return !excludes.some((pattern) => picomatch.isMatch(path, pattern));
    }

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

function getMutualRoot(patterns: string[], configRoot: string) {
    let upwardLevel = 0;
    for (let pattern of patterns) {
        let level = 0;
        while (pattern.startsWith("../")) {
            pattern = pattern.slice(3);
            level++;
        }
        if (upwardLevel < level) {
            upwardLevel = level;
        }
    }
    return join(configRoot, ...Array.from({ length: upwardLevel }, () => ".."));
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
        cursor++;
    }

    const groups: Record<string, typeof diagnostics> = {};
    for (const diagnostic of diagnostics) {
        let group = groups[diagnostic.path];
        if (!group) {
            groups[diagnostic.path] = group = [];
        }
        group.push(diagnostic);
    }
    return groups;
}
