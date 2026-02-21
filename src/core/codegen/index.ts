import { type Mapping, SourceMap, type VueCompilerOptions } from "@vue/language-core";
import { camelize, capitalize } from "@vue/shared";
import { findDynamicImports, findStaticImports } from "mlly";
import { toString } from "muggle-string";
import { basename, extname } from "pathe";
import { createCompilerOptionsBuilder, parseLocalCompilerOptions } from "../compilerOptions";
import { createIR, type IRBlock } from "../parse/ir";
import { collectScriptRanges } from "./ranges/script";
import { collectScriptSetupRanges } from "./ranges/scriptSetup";
import { generateScript } from "./script";
import { generateStyle } from "./style";
import { generateTemplate } from "./template";
import type { Code, CodeInformation } from "../types";

interface File {
    sourcePath: string;
    sourceText: string;
    imports: string[];
    references: string[];
}

export interface VirtualFile extends File {
    type: "virtual";
    virtualText: string;
    virtualLang: string;
    mapper: SourceMap<CodeInformation>;
    getSourceLineAndColumn: (offset: number) => { line: number; column: number };
    getVirtualOffset: (line: number, column: number) => number;
}

export interface NativeFile extends File {
    type: "native";
}

export type SourceFile = VirtualFile | NativeFile;

const referenceRE = /\/\/\/\s*<reference\s+path=["'](.*?)["']\s*\/>/g;

export function createSourceFile(
    sourcePath: string,
    sourceText: string,
    vueCompilerOptions: VueCompilerOptions,
) {
    const sourceFile = vueCompilerOptions.extensions.some((ext) => sourcePath.endsWith(ext))
        ? createVirtualFile(sourcePath, sourceText, vueCompilerOptions)
        : createNativeFile(sourcePath, sourceText);

    for (const item of findStaticImports(sourceText)) {
        sourceFile.imports.push(item.specifier);
    }
    for (const item of findDynamicImports(sourceText)) {
        sourceFile.imports.push(item.expression.slice(1, -1));
    }
    for (const [, path] of sourceText.matchAll(referenceRE)) {
        sourceFile.references.push(path);
    }

    return sourceFile;
}

function createVirtualFile(
    sourcePath: string,
    sourceText: string,
    vueCompilerOptions: VueCompilerOptions,
): SourceFile {
    const ir = createIR(sourceText);
    const virtualLang = ir.scriptSetup?.lang ?? ir.script?.lang ?? "ts";

    // #region vueCompilerOptions
    const options = parseLocalCompilerOptions(ir.comments);
    if (options) {
        const builder = createCompilerOptionsBuilder();
        builder.add(options, sourcePath);
        vueCompilerOptions = builder.build(vueCompilerOptions);
    }
    // #endregion

    // #region scriptRanges
    const scriptRanges = ir.script && collectScriptRanges(ir.script, vueCompilerOptions);
    // #endregion

    // #region scriptSetupRanges
    const scriptSetupRanges = ir.scriptSetup && collectScriptSetupRanges(ir.scriptSetup, vueCompilerOptions);
    // #endregion

    // #region setupConsts
    const setupConsts = new Set<string>();
    if (ir.scriptSetup && scriptSetupRanges) {
        for (const range of scriptSetupRanges.components) {
            setupConsts.add(ir.scriptSetup.content.slice(range.start, range.end));
        }
        if (ir.script && scriptRanges) {
            for (const range of scriptRanges.components) {
                setupConsts.add(ir.script.content.slice(range.start, range.end));
            }
        }
    }
    if (scriptSetupRanges?.defineProps) {
        const { destructured, destructuredRest } = scriptSetupRanges.defineProps;
        if (destructured) {
            for (const name of destructured) {
                setupConsts.add(name);
            }
        }
        if (destructuredRest) {
            setupConsts.add(destructuredRest);
        }
    }
    // #endregion

    // #region setupRefs
    const setupRefs = new Set(
        scriptSetupRanges?.useTemplateRef.map(({ name }) => name).filter((name) => name !== void 0),
    );
    // #endregion

    // #region inheritAttrs
    const inheritAttrs = (
        scriptSetupRanges?.defineOptions?.inheritAttrs ?? scriptRanges?.exportDefault?.options?.inheritAttrs
    ) !== false;
    // #endregion

    // #region componentName
    let componentName: string;
    if (ir.script && scriptRanges?.exportDefault?.options?.name) {
        const { name } = scriptRanges.exportDefault.options;
        componentName = ir.script.content.slice(name.start + 1, name.end - 1);
    }
    else if (ir.scriptSetup && scriptSetupRanges?.defineOptions?.name) {
        componentName = scriptSetupRanges.defineOptions.name;
    }
    else {
        componentName = basename(sourcePath, extname(sourcePath));
    }
    componentName = capitalize(camelize(componentName));
    // #endregion

    // #region generatedTemplate
    const generatedTemplate = ir.template && !vueCompilerOptions.skipTemplateCodegen
        ? generateTemplate({
            vueCompilerOptions,
            template: ir.template,
            setupConsts,
            setupRefs,
            hasDefineSlots: scriptSetupRanges?.defineSlots !== void 0,
            propsAssignName: scriptSetupRanges?.defineProps?.name,
            slotsAssignName: scriptSetupRanges?.defineSlots?.name,
            componentName,
            inheritAttrs,
        })
        : void 0;
    // #endregion

    // #region generatedStyle
    const generatedStyle = ir.styles.length && !vueCompilerOptions.skipTemplateCodegen
        ? generateStyle({
            vueCompilerOptions,
            styles: ir.styles,
            setupConsts,
            setupRefs,
        })
        : void 0;
    // #endregion

    // #region declaredVariables
    const declaredVariables = new Set<string>();
    if (ir.scriptSetup && scriptSetupRanges) {
        for (const range of scriptSetupRanges.bindings) {
            const name = ir.scriptSetup.content.slice(range.start, range.end);
            declaredVariables.add(name);
        }
    }
    if (ir.script && scriptRanges) {
        for (const range of scriptRanges.bindings) {
            const name = ir.script.content.slice(range.start, range.end);
            declaredVariables.add(name);
        }
    }
    // #endregion

    // #region setupExposed
    const setupExposed = new Set<string>();
    for (const name of [
        ...generatedTemplate?.accessedVars ?? [],
        ...generatedStyle?.accessedVars ?? [],
    ]) {
        if (declaredVariables.has(name)) {
            setupExposed.add(name);
        }
    }
    for (const component of ir.template?.ast.components ?? []) {
        for (const name of new Set([camelize(component), capitalize(camelize(component))])) {
            if (declaredVariables.has(name)) {
                setupExposed.add(name);
            }
        }
    }
    // #endregion

    // #region generatedScript
    const generatedScript = generateScript({
        vueCompilerOptions,
        sourcePath,
        script: ir.script,
        scriptSetup: ir.scriptSetup,
        scriptRanges,
        scriptSetupRanges,
        templateAndStyleCodes: [
            ...generatedTemplate?.codes ?? [],
            ...generatedStyle?.codes ?? [],
        ],
        templateAndStyleTypes: new Set([
            ...generatedTemplate?.generatedTypes ?? [],
            ...generatedStyle?.generatedTypes ?? [],
        ]),
        exposed: setupExposed,
    });
    // #endregion

    const blocks: Record<string, IRBlock> = {};
    for (const block of [
        ir.template,
        ir.script,
        ir.scriptSetup,
        ...ir.styles,
        ...ir.customBlocks,
    ]) {
        if (block) {
            blocks[block.name] = block;
        }
    }

    const codes = generatedScript.codes.map<Code>((code) => {
        if (typeof code === "string") {
            return code;
        }
        if (code[1] === void 0 || code[1] === "main") {
            return code;
        }
        const block = blocks[code[1]];
        if (!block) {
            return code;
        }
        return [
            code[0],
            void 0,
            code[2] + block.innerStart,
            code[3],
        ];
    });

    const mappings = createMappings(codes);
    const mapper = new SourceMap<CodeInformation>(mappings);
    const virtualText = toString(codes);

    return {
        type: "virtual",
        sourcePath,
        sourceText,
        virtualText,
        virtualLang,
        mapper,
        imports: [],
        references: [],
        getSourceLineAndColumn: createLineAndColumnGetter(sourceText),
        getVirtualOffset: createOffsetGetter(virtualText),
    };
}

function createNativeFile(sourcePath: string, sourceText: string): SourceFile {
    return {
        type: "native",
        sourcePath,
        sourceText,
        imports: [],
        references: [],
    };
}

function createMappings(codes: Code[]) {
    const originalMappings: Mapping<CodeInformation>[] = [];

    let length = 0;
    for (const code of codes) {
        if (typeof code === "string") {
            length += code.length;
            continue;
        }
        else {
            originalMappings.push({
                sourceOffsets: [code[2]],
                generatedOffsets: [length],
                lengths: [code[0].length],
                data: code[3],
            });
            length += code[0].length;
        }
    }

    const mappings: typeof originalMappings = [];
    const tokens: Record<symbol, Mapping> = {};

    for (const mapping of originalMappings) {
        if (mapping.data.__combineToken) {
            const token = mapping.data.__combineToken;
            if (token in tokens) {
                const target = tokens[token];
                target.sourceOffsets.push(...mapping.sourceOffsets);
                target.generatedOffsets.push(...mapping.generatedOffsets);
                target.lengths.push(...mapping.lengths);
            }
            else {
                tokens[token] = mapping;
                mappings.push(mapping);
            }
            continue;
        }
        mappings.push(mapping);
    }
    return mappings;
}

function createOffsetGetter(text: string) {
    const lineOffsets: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") {
            lineOffsets.push(i + 1);
        }
    }

    return (line: number, column: number) => {
        return lineOffsets[line - 1] + column - 1;
    };
}

function createLineAndColumnGetter(text: string) {
    const lineOffsets: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n") {
            lineOffsets.push(i + 1);
        }
    }

    return (offset: number) => {
        let line = 0;
        for (let i = 0; i < lineOffsets.length; i++) {
            if (lineOffsets[i] > offset) {
                break;
            }
            line = i;
        }
        return {
            line: line + 1,
            column: offset - lineOffsets[line] + 1,
        };
    };
}
