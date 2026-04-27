import CompilerDOM from "@vue/compiler-dom";
import { SourceMap, type VueCompilerOptions } from "@vue/language-core";
import { type Segment, toString } from "muggle-string";
import { extname } from "pathe";
import { toMappings } from "../shared";

const frontmatterRE = /^---[\s\S]*?\n---(?:\r?\n|$)/;
const codeBlockRE = /(`{3})[\s\S]+?\1/g;
const latexBlockRE = /(\${2})[\s\S]+?\1/g;
const codeSnippetRE = /^\s*<<<\s*.+/gm;
const sfcBlockRE = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g;
const htmlTagRE = /(?<=<\/?)([a-z][a-z0-9-]*)\b[^>]*(?=>)/gi;
const interpolationRE = /(?<=\{\{)[\s\S]*?(?=\}\})/g;
const inlineCodeRE = /(`{1,2})[^`]+\1/g;
const angleBracketRE = /<[^\s:]*:\S*>/g;

export function createSFC(sourcePath: string, sourceText: string, vueCompilerOptions: VueCompilerOptions) {
    const sourceLang = extname(sourcePath);

    if (vueCompilerOptions.extensions.includes(sourceLang)) {
        return parseSFC(sourceText);
    }
    else if (vueCompilerOptions.vitePressExtensions.includes(sourceLang)) {
        for (const regexp of [
            frontmatterRE,
            codeBlockRE,
            latexBlockRE,
            codeSnippetRE,
        ]) {
            sourceText = sourceText.replace(regexp, (match) => " ".repeat(match.length));
        }

        const codes: Segment[] = [];

        for (const { 0: text, index } of sourceText.matchAll(sfcBlockRE)) {
            codes.push([text, void 0, index]);
            codes.push("\n\n");
            sourceText = (
                sourceText.slice(0, index) + " ".repeat(text.length) + sourceText.slice(index + text.length)
            );
        }

        const unranges: [number, number][] = [];
        for (const regexp of [htmlTagRE, interpolationRE]) {
            for (const { 0: text, index } of sourceText.matchAll(regexp)) {
                unranges.push([index, index + text.length]);
            }
        }

        for (const regexp of [inlineCodeRE, angleBracketRE]) {
            for (const { 0: text, index } of sourceText.matchAll(regexp)) {
                if (unranges.some(([start, end]) => index >= start && index < end)) {
                    continue;
                }
                sourceText = (
                    sourceText.slice(0, index) + " ".repeat(text.length) + sourceText.slice(index + text.length)
                );
            }
        }

        codes.push("<template>\n");
        codes.push([sourceText, void 0, 0]);
        codes.push("\n</template>");

        const mappings = toMappings(codes);
        const mapper = new SourceMap(mappings);
        const sfc = parseSFC(toString(codes));

        for (const { tag, loc, innerLoc } of sfc.children as CompilerDOM.ElementNode[]) {
            const positions = [loc.start, loc.end, innerLoc!.start, innerLoc!.end];
            if (tag === "template") {
                for (const pos of positions) {
                    pos.offset -= mappings.at(-1)!.generatedOffsets[0];
                }
            }
            for (const pos of positions) {
                // eslint-disable-next-line no-unreachable-loop
                for (const [offset] of mapper.toSourceLocation(pos.offset)) {
                    pos.offset = offset;
                    break;
                }
            }
        }

        return sfc;
    }
    else {
        throw new Error(`[Vue] Unsupported file extension: ${sourceLang}`);
    }
}

function parseSFC(sourceText: string) {
    const errors: CompilerDOM.CompilerError[] = [];
    const warnings: CompilerDOM.CompilerError[] = [];
    const options: CompilerDOM.CompilerOptions = {
        comments: true,
        parseMode: "sfc",
        isNativeTag: () => true,
        isPreTag: () => true,
        onError: (error) => errors.push(error),
        onWarn: (error) => warnings.push(error),
    };

    return CompilerDOM.parse(sourceText, options);
}
