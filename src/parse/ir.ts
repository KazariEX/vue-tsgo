import CompilerDOM, { type RootNode } from "@vue/compiler-dom";
import { type Comment, type OxcError, parseSync, type Program } from "oxc-parser";
import { getAttributeValueOffset } from "../shared";
import { parseStyleBindings, parseStyleClassNames } from "./style/parse";
import { parseTemplate } from "./template/parse";

export interface IR {
    fileName: string;
    template?: IRTemplate;
    script?: IRScript;
    scriptSetup?: IRScriptSetup;
    styles: IRStyle[];
    comments: string[];
    customBlocks: IRCustomBlock[];
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
}

export interface IRScriptSetup extends IRBlock {
    ast: Program;
    comments: Comment[];
    errors: OxcError[];
}

export interface IRStyle extends IRBlock {
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

export function createIR(fileName: string, source: string) {
    const errors: CompilerDOM.CompilerError[] = [];
    const warnings: CompilerDOM.CompilerError[] = [];

    const sfc = CompilerDOM.parse(source, {
        comments: true,
        parseMode: "sfc",
        onError: (err) => errors.push(err),
        onWarn: (warn) => warnings.push(warn),
        expressionPlugins: ["typescript"],
    });

    const ir: IR = {
        fileName,
        styles: [],
        comments: [],
        customBlocks: [],
    };

    for (const node of sfc.children) {
        if (node.type === CompilerDOM.NodeTypes.COMMENT) {
            ir.comments.push(node.content);
            continue;
        }
        else if (node.type !== CompilerDOM.NodeTypes.ELEMENT) {
            continue;
        }

        switch (node.tag) {
            case "template": {
                const block = createIRBlock(sfc, node, "html");
                const errors: CompilerDOM.CompilerError[] = [];
                const warnings: CompilerDOM.CompilerError[] = [];
                const options: CompilerDOM.CompilerOptions = {
                    onError: (err) => errors.push(err),
                    onWarn: (warn) => warnings.push(warn),
                    expressionPlugins: ["typescript"],
                };
                const ast = parseTemplate(block.content, options);

                ir.template = {
                    ...block,
                    name: "template",
                    ast,
                    errors,
                    warnings,
                };
                break;
            }
            case "script": {
                const block = createIRBlock(sfc, node, "js");
                const result = parseSync(`yggdrasill.${block.lang}`, block.content, {
                    sourceType: "module",
                });

                if (block.attrs.setup || block.attrs.vapor) {
                    ir.scriptSetup = {
                        ...block,
                        name: "scriptSetup",
                        ast: result.program,
                        comments: result.comments,
                        errors: result.errors,
                    };
                }
                else {
                    ir.script = {
                        ...block,
                        name: "script",
                        ast: result.program,
                        comments: result.comments,
                        errors: result.errors,
                    };
                }
                break;
            }
            case "style": {
                const block = createIRBlock(sfc, node, "css");
                const bindings = [...parseStyleBindings(block.content)];
                const classNames = [...parseStyleClassNames(block.content)];

                ir.styles.push({
                    ...block,
                    name: `style_${ir.styles.length}`,
                    bindings,
                    classNames,
                });
                break;
            }
            default: {
                const block = createIRBlock(sfc, node, "txt");

                ir.customBlocks.push({
                    ...block,
                    name: `customBlock_${ir.customBlocks.length}`,
                    type: node.tag,
                });
                break;
            }
        }
    }

    return ir;
}

function createIRBlock(
    sfc: RootNode,
    node: CompilerDOM.ElementNode,
    defaultLang: string,
): Omit<IRBlock, "name"> {
    let { start, end } = node.loc;
    let content = "";

    if (node.children.length) {
        start = node.children[0].loc.start;
        end = node.children.at(-1)!.loc.end;
        content = sfc.source.slice(start.offset, end.offset);
    }
    else {
        const offset = node.loc.source.indexOf("</");
        if (offset !== -1) {
            start = {
                line: start.line,
                column: start.column + offset,
                offset: start.offset + offset,
            };
        }
        end = { ...start };
    }

    const attrs: Record<string, IRBlockAttr> = {};
    for (const prop of node.props) {
        if (prop.type !== CompilerDOM.NodeTypes.ATTRIBUTE) {
            continue;
        }
        if (!prop.value) {
            attrs[prop.name] = true;
        }
        else {
            const offset = getAttributeValueOffset(prop.value);
            attrs[prop.name] = {
                text: prop.value.content,
                offset,
                quotes: offset > prop.value.loc.start.offset,
            };
        }
    }

    return {
        lang: typeof attrs.lang === "object" ? attrs.lang.text : defaultLang,
        start: sfc.source.lastIndexOf(`<${node.tag}`, start.offset),
        end: sfc.source.indexOf(`>`) + 1,
        innerStart: start.offset,
        innerEnd: end.offset,
        attrs,
        content,
    };
}
