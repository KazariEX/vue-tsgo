import type CompilerDOM from "@vue/compiler-dom";

export function getAttributeValueOffset(node: CompilerDOM.TextNode) {
    let offset = node.loc.start.offset;
    if (node.loc.source.startsWith("\"") || node.loc.source.startsWith("'")) {
        offset++;
    }
    return offset;
}
