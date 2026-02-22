import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { stripVTControlCharacters, styleText } from "node:util";
import * as pkg from "empathic/package";
import { ResolverFactory } from "oxc-resolver";
import { dirname, extname, isAbsolute, join, relative, resolve } from "pathe";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { parse, type TSConfckParseResult } from "tsconfck";
import type { VueCompilerOptions } from "@vue/language-core";
import type { TSConfig } from "pkg-types";
import packageJson from "../../package.json";
import { createSourceFile, type SourceFile } from "./codegen";
import { createCompilerOptionsBuilder } from "./compilerOptions";
import { isVerificationEnabled, runTsgoCommand } from "./shared";

export interface Project {
    configPath: string;
    generate: () => Promise<void>;
    runTsgo: (mode: "build" | "project", args?: string[]) => Promise<void>;
    getSourceFileAndPath: (targetPath: string) => Promise<{
        sourceFile: SourceFile | undefined;
        sourcePath: string;
    } | undefined>;
}

export async function createProject(
    configPath: string,
    parsed?: TSConfckParseResult,
    parentConfigs = new Set<string>(),
): Promise<Project> {
    const configRoot = dirname(configPath);
    const configHash = createHash("sha256").update(configPath).digest("hex").slice(0, 8);

    const targetRoot = pkg.cache(`${packageJson.name}/${configHash}`, {
        cwd: configRoot,
    })!;
    if (targetRoot === void 0) {
        throw new Error("[Vue] Failed to find a target directory.");
    }

    // append to parent before async calls
    parentConfigs.add(configPath);

    parsed ??= await parse(configPath);
    const references = await Promise.all(
        parsed.referenced
            // circular reference is not expected
            ?.filter((reference) => !parentConfigs.has(reference.tsconfigFile))
            ?.map((reference) => createProject(reference.tsconfigFile, reference, parentConfigs))
        ?? [],
    );

    const builder = createCompilerOptionsBuilder();
    const resolver = new ResolverFactory({
        tsconfig: {
            configFile: configPath,
        },
        extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts", ".json", ".vue"],
    });

    for (const extended of parsed.extended?.toReversed() ?? [parsed]) {
        if ("vueCompilerOptions" in extended.tsconfig) {
            builder.add(extended.tsconfig.vueCompilerOptions, dirname(extended.tsconfigFile));
        }
    }
    const vueCompilerOptions = builder.build();

    const includes = await resolveFiles(parsed.tsconfig, configPath, vueCompilerOptions);
    const sourceToFiles = new Map<string, SourceFile>();
    const targetToFiles = new Map<string, SourceFile>();

    // process files in parallel waves:
    // read files, run codegen, resolve imports, repeat for newly discovered files
    let pending = [...includes];
    while (pending.length) {
        // read all pending files in parallel
        const entries = await Promise.all(
            pending.map(async (path) => ({
                path,
                sourceText: await readFile(path, "utf-8").catch(() => void 0),
            })),
        );

        // process each file (sync codegen) and collect import specifiers
        const importSpecs: { path: string; specifier: string }[] = [];
        for (const { path, sourceText } of entries) {
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
                importSpecs.push({ path, specifier });
            }
        }

        // resolve all import specifiers in parallel
        const resolved = await Promise.all(
            importSpecs.map(async ({ path, specifier }) => {
                const result = await resolver.resolveFileAsync(path, specifier);
                return result?.path;
            }),
        );

        // collect newly discovered files for the next wave
        pending = [];
        for (const resolvedPath of resolved) {
            if (
                resolvedPath === void 0 ||
                resolvedPath.includes("/node_modules/") ||
                includes.has(resolvedPath)
            ) {
                continue;
            }
            includes.add(resolvedPath);
            pending.push(resolvedPath);
        }
    }

    const sourceRoot = getMutualRoot(includes, configRoot);
    const toSourcePath = (path: string) => join(sourceRoot, relative(targetRoot, path));
    const toTargetPath = (path: string) => join(targetRoot, relative(sourceRoot, path));
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
        await Promise.all(references.map((project) => project.generate()));
        await rm(targetRoot, { recursive: true, force: true });

        // global types for Vue SFCs
        const types: string[] = ["template-helpers.d.ts"];
        if (!vueCompilerOptions.checkUnknownProps) {
            types.push("props-fallback.d.ts");
        }
        if (vueCompilerOptions.lib === "vue" && vueCompilerOptions.target < 3.5) {
            types.push("vue-3.4-shims.d.ts");
        }

        const resolvedPaths: Record<string, string[]> = {
            [`${sourceRoot}/*`]: [`${targetRoot}/*`],
        };

        for (const config of parsed!.extended?.toReversed() ?? [parsed!]) {
            const configDir = dirname(config.tsconfigFile);

            for (const [pattern, paths] of Object.entries<string[]>(
                config.tsconfig.compilerOptions?.paths ?? {},
            )) {
                resolvedPaths[pattern] = paths.map((path) => {
                    const absolutePath = isAbsolute(path) ? path : join(configDir, path);
                    return relative(sourceRoot, absolutePath).startsWith("..")
                        ? absolutePath
                        : toTargetPath(absolutePath);
                });
            }
        }

        const tsconfigPath = toTargetPath(configPath);
        const tsconfigDir = dirname(tsconfigPath);
        const tsconfig: TSConfig = {
            ...parsed!.tsconfig,
            extends: void 0,
            compilerOptions: {
                ...parsed!.tsconfig.compilerOptions,
                paths: resolvedPaths,
                types: [
                    ...parsed!.tsconfig.compilerOptions?.types ?? [],
                    ...types.map((name) => join(vueCompilerOptions.typesRoot, name)),
                ],
            },
            references: references.map((project) => ({
                path: project.configPath,
            })),
            // provide a explicit file list to avoid potential edge cases of path resolution
            files: [...targetToFiles.keys()].map((path) => relative(tsconfigDir, path)).sort(),
            include: void 0,
            exclude: void 0,
        };

        // pre-collect and create all target directories
        const dirs = new Set<string>();
        const tasks: (() => Promise<void>)[] = [];

        // 1. tsconfig
        dirs.add(tsconfigDir);
        tasks.push(() => writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2)));

        // 2. source files
        for (const path of includes) {
            const sourceFile = sourceToFiles.get(path)!;
            const targetPath = sourceFile.type === "virtual"
                ? toTargetPath(path) + "." + toTargetLang(sourceFile.virtualLang)
                : toTargetPath(path);

            dirs.add(dirname(targetPath));
            tasks.push(() => writeFile(
                targetPath,
                sourceFile.type === "virtual" ? sourceFile.virtualText : sourceFile.sourceText,
            ));
        }

        // 3. node_modules (symlink)
        for (const name of ["package.json", "node_modules"]) {
            const path = join(sourceRoot, name);
            tasks.push(() => symlink(path, toTargetPath(path)).catch(() => void 0));
        }

        // write all directories first
        await Promise.all([...dirs].map((dir) => mkdir(dir, { recursive: true })));

        // write all files in parallel
        await Promise.all(tasks.map((task) => task()));
    }

    async function runTsgo(mode: "build" | "project", args: string[] = []) {
        await generate();

        const output = await runTsgoCommand([
            ...[`--${mode}`, toTargetPath(configPath)],
            ...["--pretty", "true"],
            ...args,
        ], { resolver });

        const { groups, rest } = parseStdout(output.stdout);
        const stats: { path: string; line: number; count: number }[] = [];

        for (const [originalPath, diagnostics] of Object.entries(groups)) {
            const {
                sourceFile,
                sourcePath = originalPath,
            } = await getSourceFileAndPath(originalPath) ?? {};

            if (sourceFile?.type === "virtual") {
                if (
                    sourceFile.virtualLang !== "ts" &&
                    sourceFile.virtualLang !== "tsx" &&
                    parsed!.tsconfig.compilerOptions?.checkJs !== true
                ) {
                    diagnostics.length = 0;
                }

                outer: for (let i = 0; i < diagnostics.length; i++) {
                    const diagnostic = diagnostics[i];

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
            }

            const relativePath = relative(process.cwd(), sourcePath);
            const sourceText = sourceFile?.sourceText ?? await readFile(sourcePath, "utf-8");
            const lines = sourceText.split("\n");

            for (const { start, end, code, message } of diagnostics) {
                console.info(`${styleText("cyanBright", relativePath)}:${styleText("yellowBright", String(start.line))}:${styleText("yellowBright", String(start.column))} - ${styleText("redBright", "error")} ${styleText("gray", `TS${code}:`)} ${message}\n`);

                const padding = String(end.line).length;
                const printedLines = lines.slice(start.line - 1, end.line);

                for (let i = 0; i < printedLines.length; i++) {
                    const line = printedLines[i];
                    const columnStart = i === 0 ? start.column - 1 : 0;
                    const columnEnd = i === printedLines.length - 1 ? end.column - 1 : line.length;

                    console.info(`\x1B[7m${String(start.line + i).padStart(padding, " ")}\x1B[0m ${line}`);
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

            if (count === 1) {
                console.info(`\nFound ${count} error in ${path}${styleText("gray", `:${line}`)}`);
            }
            else {
                console.info(`\nFound ${count} errors in the same file, starting at: ${path}${styleText("gray", `:${line}`)}`);
            }
        }
        else if (stats.length > 1) {
            const total = stats.reduce((prev, curr) => prev + curr.count, 0);

            console.info(`\nFound ${total} errors in ${stats.length} files.\n`);
            console.info(`Errors  Files`);

            for (const { path, line, count } of stats) {
                console.info(`${String(count).padStart(6)}  ${path}${styleText("gray", `:${line}`)}`);
            }
        }

        if (rest.length) {
            console.info(rest);
        }

        if (stats.length) {
            process.exit(1);
        }
    }

    async function getSourceFileAndPath(targetPath: string) {
        const sourceFile = targetToFiles.get(targetPath);
        const sourcePath = sourceFile?.sourcePath ?? (
            targetPath.startsWith(targetRoot) ? toSourcePath(targetPath) : void 0
        );

        if (sourcePath !== void 0) {
            return {
                sourceFile,
                sourcePath,
            };
        }

        for (const project of references) {
            const result = await project.getSourceFileAndPath(targetPath);
            if (result !== void 0) {
                return result;
            }
        }
    }

    return {
        configPath: toTargetPath(configPath),
        generate,
        runTsgo,
        getSourceFileAndPath,
    };
}

async function resolveFiles(config: TSConfig, configPath: string, vueCompilerOptions: VueCompilerOptions) {
    const configRoot = dirname(configPath);
    const extensions = new Set([
        ...[".ts", ".tsx", ".js", ".jsx", ".json", ".mjs", ".mts", ".cjs", ".cts"],
        ...vueCompilerOptions.extensions,
    ]);

    const includes = await Promise.all(
        config.include?.map(async (pattern) => {
            pattern = await transformPattern(pattern);
            if (!pattern.includes("*")) {
                return join(configRoot, pattern);
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
            join(configRoot, await transformPattern(pattern)),
        )) ?? [],
    );

    return new Set(
        includes.flat().filter((path) => (
            path !== configPath &&
            extensions.has(extname(path)) &&
            excludes.every((match) => !match(path))
        )),
    );

    async function transformPattern(pattern: string) {
        if (pattern.includes("*")) {
            return pattern;
        }
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

function parseStdout(stdout: string) {
    const diagnostics: Diagnostic[] = [];
    const plaintext = stripVTControlCharacters(stdout);
    const lines = plaintext.trim().split("\n");

    let i = 0;
    if (diagnosticRE.test(lines[0])) {
        let cursor = 0;
        let padding = 0;

        for (; i < lines.length; i++) {
            const text = lines[i];
            if (text.startsWith("Found 1 ") || text.includes("in the same file")) {
                i++;
                break;
            }
            else if (text.startsWith("Found ")) {
                i += 3;
                while (lines[i]?.length) {
                    i++;
                }
                break;
            }

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
    }

    const groups: Record<string, typeof diagnostics> = {};
    for (const diagnostic of diagnostics) {
        (groups[diagnostic.path] ??= []).push(diagnostic);
    }

    return {
        groups,
        rest: lines.slice(i).join("\n"),
    };
}
