import { type Comment, type OxcError, parseSync, type Program } from "oxc-parser";
import type CompilerDOM from "@vue/compiler-dom";
import type { SFCBlock, SFCDescriptor } from "@vue/compiler-sfc";
import { parseStyleBindings, parseStyleClassNames } from "./style/parse";
import { parseTemplate } from "./template/parse";

export interface IR {
    template?: IRTemplate;
    script?: IRScript;
    scriptSetup?: IRScriptSetup;
    styles: IRStyle[];
    customBlocks: IRCustomBlock[];
    comments: string[];
}

export interface IRBlock {
    name: string;
    lang: string;
    start: number;
    end: number;
    innerStart: number;
    innerEnd: number;
    attrs: Record<string, IRBlockAttr>;
    content: string;
}

export type IRBlockAttr = true | {
    text: string;
    offset: number;
    quotes: boolean;
};

export interface IRTemplate extends IRBlock {
    ast: CompilerDOM.RootNode;
    errors: CompilerDOM.CompilerError[];
    warnings: CompilerDOM.CompilerError[];
}

export interface IRScript extends IRBlock {
    ast: Program;
    comments: Comment[];
    errors: OxcError[];
    src?: IRBlockAttr;
}

export interface IRScriptSetup extends IRBlock {
    ast: Program;
    comments: Comment[];
    errors: OxcError[];
    generic?: IRBlockAttr;
}

export interface IRStyle extends IRBlock {
    module?: IRBlockAttr;
    bindings: {
        text: string;
        offset: number;
    }[];
    classNames: {
        text: string;
        offset: number;
    }[];
}

export interface IRCustomBlock extends IRBlock {
    type: string;
}

export function createIR(sfc: SFCDescriptor) {
    const ir: IR = {
        styles: [],
        customBlocks: [],
        comments: sfc.comments,
    };

    if (sfc.template) {
        ir.template = createIRBlock(sfc, sfc.template, "template", "html", (block) => {
            const errors: CompilerDOM.CompilerError[] = [];
            const warnings: CompilerDOM.CompilerError[] = [];
            const options: CompilerDOM.CompilerOptions = {
                onError: (err) => errors.push(err),
                onWarn: (warn) => warnings.push(warn),
                expressionPlugins: ["typescript"],
            };
            const ast = parseTemplate(block.content, options);

            return {
                ...block,
                ast,
                errors,
                warnings,
            };
        });
    }

    if (sfc.script) {
        ir.script = createIRBlock(sfc, sfc.script, "script", "js", (block) => {
            const result = parseSync(sfc.filename, block.content, {
                lang: block.lang as "js" | "ts" | "jsx" | "tsx",
                sourceType: "module",
            });
            const src = createIRAttr("__src", sfc.script!, block);

            return {
                ...block,
                ast: result.program,
                comments: result.comments,
                errors: result.errors,
                src,
            };
        });
    }

    if (sfc.scriptSetup) {
        ir.scriptSetup = createIRBlock(sfc, sfc.scriptSetup, "scriptSetup", "js", (block) => {
            const result = parseSync(sfc.filename, block.content, {
                lang: block.lang as "js" | "ts" | "jsx" | "tsx",
                sourceType: "module",
            });
            const generic = createIRAttr("__generic", sfc.scriptSetup!, block);

            return {
                ...block,
                ast: result.program,
                comments: result.comments,
                errors: result.errors,
                generic,
            };
        });
    }

    for (let i = 0; i < sfc.styles.length; i++) {
        const style = sfc.styles[i];
        const block = createIRBlock(sfc, style, `style_${i}`, "css", (block) => {
            const module = createIRAttr("__module", style, block);
            const bindings = [...parseStyleBindings(block.content)];
            const classNames = [...parseStyleClassNames(block.content)];

            return {
                ...block,
                module,
                bindings,
                classNames,
            };
        });
        ir.styles.push(block);
    }

    for (let i = 0; i < sfc.customBlocks.length; i++) {
        const customBlock = sfc.customBlocks[i];
        const block = createIRBlock(sfc, customBlock, `customBlock_${i}`, "txt", (block) => {
            return {
                ...block,
                type: customBlock.type,
            };
        });
        ir.customBlocks.push(block);
    }

    return ir;
}

function createIRBlock<T>(
    sfc: SFCDescriptor,
    original: SFCBlock,
    name: string,
    defaultLang: string,
    getter: (block: IRBlock) => T,
): T {
    return getter({
        name,
        lang: original.lang ?? defaultLang,
        start: sfc.source.lastIndexOf(`<${original.type}`, original.loc.start.offset),
        end: sfc.source.indexOf(`>`) + 1,
        innerStart: original.loc.start.offset,
        innerEnd: original.loc.end.offset,
        attrs: {},
        content: original.content,
    });
}

function createIRAttr<T extends SFCBlock>(
    key: keyof T & string,
    original: T,
    block: IRBlock,
) {
    const val = original[key] as IRBlockAttr | undefined;
    if (typeof val === "object") {
        return {
            ...val,
            offset: block.start + val.offset,
        };
    }
    return val;
}
