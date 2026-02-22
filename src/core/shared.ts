import { hyphenate } from "@vue/shared";
import { ResolverFactory } from "oxc-resolver";
import { join } from "pathe";
import { exec, type Options } from "tinyexec";
import type CompilerDOM from "@vue/compiler-dom";
import type { IRTemplate } from "./parse/ir";
import type { CodeInformation } from "./types";

export async function runTsgoCommand(
    args: string[],
    options?: Partial<Options> & {
        resolver?: ResolverFactory;
    },
) {
    const resolver = options?.resolver ?? ResolverFactory.default();
    const resolvedTsgo = await resolver.async(process.cwd(), "@typescript/native-preview/package.json");

    if (resolvedTsgo?.path === void 0) {
        console.error(`[Vue] Failed to resolve the path of tsgo. Please ensure the @typescript/native-preview package is installed.`);
        process.exit(1);
    }
    const tsgo = join(resolvedTsgo.path, "../bin/tsgo.js");

    return exec(process.execPath, [tsgo, ...args], options);
}

export { hyphenate as hyphenateTag };

export function hyphenateAttr(str: string) {
    let hyphenated = hyphenate(str);
    if (str && str[0] !== str[0].toLowerCase()) {
        hyphenated = "-" + hyphenated;
    }
    return hyphenated;
}

export function getAttributeValueOffset(node: CompilerDOM.TextNode) {
    let offset = node.loc.start.offset;
    if (node.loc.source.startsWith("\"") || node.loc.source.startsWith("'")) {
        offset++;
    }
    return offset;
}

export function getElementTagOffsets(node: CompilerDOM.ElementNode, template: IRTemplate) {
    const offsets = [
        template.ast.source.indexOf(node.tag, node.loc.start.offset),
    ];
    if (!node.isSelfClosing && template.lang === "html") {
        const endTagOffset = node.loc.start.offset + node.loc.source.lastIndexOf(node.tag);
        if (endTagOffset > offsets[0]) {
            offsets.push(endTagOffset);
        }
    }
    return offsets as [number] | [number, number];
}

export function isVerificationEnabled(data: CodeInformation, code: number) {
    return data.verification === true ||
        typeof data.verification === "object" &&
        data.verification.shouldReport(code) === true;
}
