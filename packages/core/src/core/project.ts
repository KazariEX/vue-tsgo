import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import * as pkg from "empathic/package";
import { ResolverFactory } from "oxc-resolver";
import { dirname, extname, isAbsolute, join, relative } from "pathe";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { parse, type TSConfckParseResult } from "tsconfck";
import { createMessageConnection, RequestType, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js";
import type { VueCompilerOptions } from "@vue/language-core";
import type { TSConfig } from "pkg-types";
import type { DocumentDiagnosticParams, FullDocumentDiagnosticReport } from "vscode-languageserver-protocol";
import packageJson from "../../package.json";
import { createSourceFile, type SourceFile } from "./codegen";
import { createCompilerOptionsBuilder } from "./compilerOptions";
import { isVerificationEnabled, runTsgoCommand } from "./shared";

export class Project {
    private configRoot: string;
    private configHash: string;
    private targetRoot: string;
    private sourceRoot!: string;
    private resolver!: ResolverFactory;
    private vueCompilerOptions!: VueCompilerOptions;
    private sourceToFiles = new Map<string, SourceFile>();
    private targetToFiles = new Map<string, SourceFile>();
    private references!: Project[];
    private includes!: Set<string>;

    // exposed for references
    private configTarget!: string;

    constructor(
        private configPath: string,
        private parsed?: TSConfckParseResult,
        private linkedConfigs = new Set<string>(),
    ) {
        this.configRoot = dirname(configPath);
        this.configHash = createHash("sha256").update(configPath).digest("hex").slice(0, 8);

        this.targetRoot = pkg.cache(`${packageJson.name}/${this.configHash}`, {
            cwd: this.configRoot,
        })!;
        if (this.targetRoot === void 0) {
            throw new Error("[Vue] Failed to find a target directory.");
        }

        // append to parent before async calls
        linkedConfigs.add(configPath);
    }

    private toTargetPath(path: string) {
        return join(this.targetRoot, relative(this.sourceRoot, path));
    }

    // avoid parsing errors for TS specific syntax in JS files
    private toTargetLang(lang: string) {
        return lang === "js" ? "ts" : lang === "jsx" ? "tsx" : lang;
    }

    async initialize() {
        this.parsed ??= await parse(this.configPath);
        this.references = await Promise.all(
            this.parsed.referenced
                // circular reference is not expected
                ?.filter((reference) => !this.linkedConfigs.has(reference.tsconfigFile))
                ?.map(async (reference) => {
                    const project = new Project(reference.tsconfigFile, reference, this.linkedConfigs);
                    await project.initialize();
                    return project;
                })
            ?? [],
        );

        const builder = createCompilerOptionsBuilder();
        this.resolver = new ResolverFactory({
            tsconfig: {
                configFile: this.configPath,
            },
            extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts", ".json", ".vue"],
        });

        for (const extended of this.parsed.extended?.toReversed() ?? [this.parsed]) {
            if ("vueCompilerOptions" in extended.tsconfig) {
                builder.add(extended.tsconfig.vueCompilerOptions, dirname(extended.tsconfigFile));
            }
        }
        this.vueCompilerOptions = builder.build();

        this.includes = await resolveFiles(this.parsed.tsconfig, this.configPath, this.vueCompilerOptions);

        // process files in parallel waves:
        // read files, run codegen, resolve imports, repeat for newly discovered files
        let pending = [...this.includes];
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
                    this.includes.delete(path);
                    continue;
                }

                const sourceFile = createSourceFile(path, sourceText, this.vueCompilerOptions);
                this.sourceToFiles.set(path, sourceFile);

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
                    const result = await this.resolver.resolveFileAsync(path, specifier);
                    return result?.path;
                }),
            );

            // collect newly discovered files for the next wave
            pending = [];
            for (const resolvedPath of resolved) {
                if (
                    resolvedPath === void 0 ||
                    resolvedPath.includes("/node_modules/") ||
                    this.includes.has(resolvedPath)
                ) {
                    continue;
                }
                this.includes.add(resolvedPath);
                pending.push(resolvedPath);
            }
        }

        this.sourceRoot = getMutualRoot(this.includes, this.configRoot);
        this.configTarget = this.toTargetPath(this.configPath);

        for (const path of this.includes) {
            const sourceFile = this.sourceToFiles.get(path)!;
            const targetPath = sourceFile.type === "virtual"
                ? this.toTargetPath(path) + "." + this.toTargetLang(sourceFile.virtualLang)
                : this.toTargetPath(path);
            this.targetToFiles.set(targetPath, sourceFile);
        }
    }

    async generate() {
        await Promise.all(this.references.map((project) => project.generate()));
        await rm(this.targetRoot, { recursive: true, force: true });

        // global types for Vue SFCs
        const types: string[] = ["template-helpers.d.ts"];
        if (!this.vueCompilerOptions.checkUnknownProps) {
            types.push("props-fallback.d.ts");
        }
        if (this.vueCompilerOptions.lib === "vue" && this.vueCompilerOptions.target < 3.5) {
            types.push("vue-3.4-shims.d.ts");
        }

        const resolvedPaths: Record<string, string[]> = {
            [`${this.sourceRoot}/*`]: [`${this.targetRoot}/*`],
        };

        for (const config of this.parsed!.extended?.toReversed() ?? [this.parsed!]) {
            const configDir = dirname(config.tsconfigFile);

            for (const [pattern, paths] of Object.entries<string[]>(
                config.tsconfig.compilerOptions?.paths ?? {},
            )) {
                resolvedPaths[pattern] = paths.map((path) => {
                    const absolutePath = isAbsolute(path) ? path : join(configDir, path);
                    return relative(this.sourceRoot, absolutePath).startsWith("..")
                        ? absolutePath
                        : this.toTargetPath(absolutePath);
                });
            }
        }

        const tsconfig: TSConfig = {
            ...this.parsed!.tsconfig,
            extends: void 0,
            compilerOptions: {
                ...this.parsed!.tsconfig.compilerOptions,
                paths: resolvedPaths,
                types: [
                    ...this.parsed!.tsconfig.compilerOptions?.types ?? [],
                    ...types.map((name) => join(this.vueCompilerOptions.typesRoot, name)),
                ],
            },
            references: this.references.map((project) => ({
                path: project.configTarget,
            })),
            include: this.parsed!.tsconfig.include?.map((pattern: string) => (
                isAbsolute(pattern) ? relative(this.configRoot, pattern) : pattern
            )),
            exclude: this.parsed!.tsconfig.exclude?.map((pattern: string) => (
                isAbsolute(pattern) ? relative(this.configRoot, pattern) : pattern
            )),
        };

        // pre-collect and create all target directories
        const dirs = new Set<string>();
        const tasks: (() => Promise<void>)[] = [];

        // 1. tsconfig
        dirs.add(dirname(this.configTarget));
        tasks.push(() => writeFile(this.configTarget, JSON.stringify(tsconfig, null, 2)));

        if (this.configTarget !== join(this.targetRoot, "tsconfig.json")) {
            const tsconfig: TSConfig = {
                references: [
                    { path: "./" + relative(this.targetRoot, this.configTarget) },
                ],
                files: [],
            };
            tasks.push(() => writeFile(
                join(this.targetRoot, "tsconfig.json"),
                JSON.stringify(tsconfig, null, 2),
            ));
        }

        // 2. source files
        for (const path of this.includes) {
            const sourceFile = this.sourceToFiles.get(path)!;
            const targetPath = sourceFile.type === "virtual"
                ? this.toTargetPath(path) + "." + this.toTargetLang(sourceFile.virtualLang)
                : this.toTargetPath(path);

            dirs.add(dirname(targetPath));
            tasks.push(() => writeFile(
                targetPath,
                sourceFile.type === "virtual" ? sourceFile.virtualText : sourceFile.sourceText,
            ));
        }

        // 3. node_modules (symlink)
        for (const name of ["package.json", "node_modules"]) {
            const path = join(this.sourceRoot, name);
            tasks.push(() => symlink(path, this.toTargetPath(path)).catch(() => void 0));
        }

        // write all directories first
        await Promise.all([...dirs].map((dir) => mkdir(dir, { recursive: true })));

        // write all files in parallel
        await Promise.all(tasks.map((task) => task()));
    }

    async check(mode: "build" | "project") {
        const { process: child } = runTsgoCommand(["--lsp", "-stdio"]);
        if (!child) {
            console.error("[Vue] Failed to start tsgo process.");
            process.exit(1);
        }

        const connection = createMessageConnection(
            new StreamMessageReader(child.stdout!),
            new StreamMessageWriter(child.stdin!),
        );
        connection.listen();

        await connection.sendRequest("initialize", {
            processId: child.pid,
            rootUri: pathToFileURL(this.targetRoot).href,
            capabilities: {},
        });

        await connection.sendNotification("initialized");

        const projects: Project[] = [this];
        if (mode === "build") {
            for (const project of projects) {
                projects.push(...project.references);
            }
        }

        const stats: { path: string; line: number; count: number }[] = [];
        const outputs: string[] = [];

        const tasks = Iterator.from(projects).flatMap(
            (project) => project.targetToFiles.keys().map((targetPath) => async () => {
                const sourceFile = project.targetToFiles.get(targetPath)!;

                const report = await connection.sendRequest(new RequestType<
                    DocumentDiagnosticParams,
                    FullDocumentDiagnosticReport,
                    void
                >("textDocument/diagnostic"), {
                    textDocument: {
                        uri: pathToFileURL(targetPath).href,
                    },
                });

                const diagnostics = report.items.filter((item) => !(
                    item.code === 6385 ||
                    item.code === 6133 && (
                        project.parsed!.tsconfig.compilerOptions?.noUnusedLocals !== true &&
                        project.parsed!.tsconfig.compilerOptions?.noUnusedParameters !== true
                    )
                ));

                if (sourceFile.type === "virtual") {
                    if (
                        sourceFile.virtualLang !== "ts" &&
                        sourceFile.virtualLang !== "tsx" &&
                        project.parsed!.tsconfig.compilerOptions?.checkJs !== true
                    ) {
                        diagnostics.length = 0;
                    }

                    outer: for (let i = 0; i < diagnostics.length; i++) {
                        const diagnostic = diagnostics[i];

                        // eslint-disable-next-line no-unreachable-loop
                        for (const [start, end] of sourceFile.mapper.toSourceRange(
                            sourceFile.getVirtualOffset(
                                diagnostic.range.start.line,
                                diagnostic.range.start.character,
                            ),
                            sourceFile.getVirtualOffset(
                                diagnostic.range.end.line,
                                diagnostic.range.end.character,
                            ),
                            true,
                            (data) => isVerificationEnabled(data, diagnostic.code as number),
                        )) {
                            diagnostic.range.start = sourceFile.getSourceLineAndCharacter(start);
                            diagnostic.range.end = sourceFile.getSourceLineAndCharacter(end);
                            continue outer;
                        }

                        diagnostics.splice(i--, 1);
                    }
                }

                const relativePath = relative(process.cwd(), sourceFile.sourcePath);
                const sourceText = sourceFile?.sourceText ?? await readFile(sourceFile.sourcePath, "utf-8");
                const lines = sourceText.split("\n");

                for (const { range: { start, end }, code, message } of diagnostics) {
                    outputs.push(`${styleText("cyanBright", relativePath)}:${styleText("yellowBright", String(start.line + 1))}:${styleText("yellowBright", String(start.character + 1))} - ${styleText("redBright", "error")} ${styleText("gray", `TS${code}:`)} ${message}\n`);

                    const padding = String(end.line + 1).length;
                    const printedLines = lines.slice(start.line, end.line + 1);

                    for (let i = 0; i < printedLines.length; i++) {
                        const line = printedLines[i];
                        const columnStart = i === 0 ? start.character : 0;
                        const columnEnd = i === printedLines.length - 1 ? end.character : line.length;

                        outputs.push(`\x1B[7m${String(start.line + i + 1).padStart(padding, " ")}\x1B[0m ${line}`);
                        outputs.push(`\x1B[7m${" ".repeat(padding)}\x1B[0m ${" ".repeat(columnStart)}${styleText("redBright", "~".repeat(columnEnd - columnStart))}\n`);
                    }
                }

                if (diagnostics.length) {
                    stats.push({
                        path: relativePath,
                        line: diagnostics[0].range.start.line,
                        count: diagnostics.length,
                    });
                }
            }),
        );

        // align with default checker size in tsgo
        // https://github.com/microsoft/typescript-go/blob/31304ca/internal/compiler/checkerpool.go#L31
        await runTasks(tasks, 4);

        connection.end();

        if (stats.length === 1) {
            const { path, line, count } = stats[0];

            if (count === 1) {
                outputs.push(`\nFound ${count} error in ${path}${styleText("gray", `:${line + 1}`)}`);
            }
            else {
                outputs.push(`\nFound ${count} errors in the same file, starting at: ${path}${styleText("gray", `:${line + 1}`)}`);
            }
        }
        else if (stats.length > 1) {
            const total = stats.reduce((prev, curr) => prev + curr.count, 0);

            outputs.push(`\nFound ${total} errors in ${stats.length} files.\n`);
            outputs.push(`Errors  Files`);

            for (const { path, line, count } of stats) {
                outputs.push(`${String(count).padStart(6)}  ${path}${styleText("gray", `:${line + 1}`)}`);
            }
        }

        console.info(outputs.join("\n"));

        if (stats.length) {
            process.exit(1);
        }
    }
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

function runTasks(tasks: Iterator<() => Promise<void>>, limit: number) {
    return new Promise<void>((resolve) => {
        let pending = 0;
        push();

        function push() {
            const task = tasks.next();
            if (task.done) {
                if (pending === 0) {
                    resolve();
                }
                return false;
            }
            pending++;
            task.value?.().then(finish);
            // eslint-disable-next-line no-empty
            while (pending < limit && push() !== false) {}
        }

        function finish() {
            pending--;
            push();
        }
    });
}
