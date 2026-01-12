import CompilerDOM from "@vue/compiler-dom";
import type { SFCBlock, SFCDescriptor, SFCParseResult, SFCScriptBlock, SFCStyleBlock, SFCTemplateBlock } from "@vue/compiler-sfc";
import { getAttributeValueOffset } from "./utils";
import type { IRBlockAttr } from "./ir";

declare module "@vue/compiler-sfc" {
    interface SFCDescriptor {
        comments: string[];
    }

    interface SFCBlock {
        __src?: IRBlockAttr;
    }

    interface SFCScriptBlock {
        __generic?: IRBlockAttr;
    }

    interface SFCStyleBlock {
        __module?: IRBlockAttr;
    }
}

export function parseSFC(source: string): SFCParseResult {
    const errors: CompilerDOM.CompilerError[] = [];
    const descriptor: SFCDescriptor = {
        filename: "yggdrasill.vue",
        source,
        comments: [],
        template: null,
        script: null,
        scriptSetup: null,
        styles: [],
        customBlocks: [],
        cssVars: [],
        slotted: false,
        shouldForceReload: () => false,
    };

    const ast = CompilerDOM.parse(source, {
        comments: true,
        isNativeTag: () => true,
        isPreTag: () => true,
        parseMode: "sfc",
        onError: (err) => errors.push(err),
    });

    for (const node of ast.children) {
        if (node.type === CompilerDOM.NodeTypes.COMMENT) {
            descriptor.comments.push(node.content);
            continue;
        }
        else if (node.type !== CompilerDOM.NodeTypes.ELEMENT) {
            continue;
        }

        switch (node.tag) {
            case "template": {
                descriptor.template = createBlock(node, source) as SFCTemplateBlock;
                break;
            }
            case "script": {
                const block = createBlock(node, source) as SFCScriptBlock;
                if (block.setup) {
                    descriptor.scriptSetup = block;
                }
                else {
                    descriptor.script = block;
                }
                break;
            }
            case "style": {
                const block = createBlock(node, source) as SFCStyleBlock;
                descriptor.styles.push(block);
                break;
            }
            default: {
                const block = createBlock(node, source);
                descriptor.customBlocks.push(block);
                break;
            }
        }
    }

    return {
        descriptor,
        errors,
    };
}

function createBlock(node: CompilerDOM.ElementNode, source: string) {
    let { start, end } = node.loc;
    let content = "";

    if (node.children.length) {
        start = node.children[0].loc.start;
        end = node.children.at(-1)!.loc.end;
        content = source.slice(start.offset, end.offset);
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

    const attrs: Record<string, any> = {};
    const block: SFCBlock = {
        type: node.tag,
        content,
        loc: {
            start,
            end,
            source: content,
        },
        attrs,
    };

    for (const prop of node.props) {
        if (prop.type !== CompilerDOM.NodeTypes.ATTRIBUTE) {
            continue;
        }

        attrs[prop.name] = prop.value ? prop.value.content || true : true;

        switch (prop.name) {
            case "lang": {
                block.lang = prop.value?.content;
                break;
            }
            case "src": {
                block.__src = createAttr(prop, node);
                break;
            }
            default: if (isScriptBlock(block)) {
                switch (prop.name) {
                    case "setup": {
                        block.setup = attrs[prop.name];
                        break;
                    }
                    case "vapor": {
                        block.setup ??= attrs[prop.name];
                        break;
                    }
                    case "generic": {
                        block.__generic = createAttr(prop, node);
                        break;
                    }
                }
            }
            else if (isStyleBlock(block)) {
                switch (prop.name) {
                    case "scoped": {
                        block.scoped = true;
                        break;
                    }
                    case "module": {
                        block.__module = createAttr(prop, node);
                        break;
                    }
                }
            }
        }
    }

    return block;
}

function isScriptBlock(block: SFCBlock): block is SFCScriptBlock {
    return block.type === "script";
}

function isStyleBlock(block: SFCBlock): block is SFCStyleBlock {
    return block.type === "style";
}

function createAttr(prop: CompilerDOM.AttributeNode, node: CompilerDOM.ElementNode): IRBlockAttr {
    if (!prop.value) {
        return true;
    }
    const offset = getAttributeValueOffset(prop.value);
    return {
        text: prop.value.content,
        offset: offset - node.loc.start.offset,
        quotes: offset > prop.value.loc.start.offset,
    };
}
