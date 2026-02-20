import { isGloballyAllowed, makeMap } from "@vue/shared";
import { parseAndWalk, ScopeTracker } from "oxc-walker";
import { names } from "../names";
import { identifierRE } from "../utils";
import type { IRBlock } from "../../parse/ir";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

// https://github.com/vuejs/core/blob/fb0c3ca519f1fccf52049cd6b8db3a67a669afe9/packages/compiler-core/src/transforms/transformExpression.ts#L47
const isLiteralWhitelisted = /*@__PURE__*/ makeMap("true,false,null,this");

export function* generateInterpolation(
    options: Pick<TemplateCodegenOptions, "setupRefs">,
    ctx: TemplateCodegenContext,
    block: IRBlock,
    code: string,
    start: number,
    features: CodeInformation,
    prefix = "",
    suffix = "",
): Generator<Code> {
    for (const segment of forEachInterpolationSegment(
        options.setupRefs,
        ctx,
        code,
        prefix,
        suffix,
    )) {
        if (typeof segment === "string") {
            yield segment;
            continue;
        }

        let [section, offset, type] = segment;
        offset -= prefix.length;
        let addSuffix = "";
        const overLength = offset + section.length - code.length;
        if (overLength > 0) {
            addSuffix = section.slice(section.length - overLength);
            section = section.slice(0, -overLength);
        }
        if (offset < 0) {
            yield section.slice(0, -offset);
            section = section.slice(-offset);
            offset = 0;
        }

        if (section.length || type !== "startEnd") {
            yield [
                section,
                block.name,
                start + offset,
                features,
            ];
        }
        yield addSuffix;
    }
}

function* forEachInterpolationSegment(
    setupRefs: Set<string>,
    ctx: TemplateCodegenContext,
    originalCode: string,
    prefix: string,
    suffix: string,
): Generator<string | [
    code: string,
    offset: number,
    type?: "startEnd",
]> {
    const code = prefix + originalCode + suffix;
    let prevEnd = 0;

    const scopeTracker = new ScopeTracker();
    const identifiers: [string, number, boolean][] = [];

    if (identifierRE.test(originalCode)) {
        identifiers.push([originalCode, prefix.length, false]);
    }
    else {
        parseAndWalk(code, "dummy.ts", {
            scopeTracker,
            enter(node, parent) {
                if (
                    node.type !== "Identifier" ||
                    parent?.type === "MemberExpression" && node !== parent.object && !parent.computed ||
                    parent?.type === "Property" && node === parent.key ||
                    parent?.type === "TSFunctionType" ||
                    parent?.type === "TSMethodSignature" ||
                    parent?.type === "TSPropertySignature" ||
                    parent?.type === "TSTypeReference" || (
                        parent?.type === "TSQualifiedName" &&
                        node !== parent.left &&
                        parent.parent?.type !== "TSTypeQuery"
                    ) ||
                    scopeTracker.isDeclared(node.name)
                ) {
                    return;
                }

                identifiers.push([node.name, node.start, parent?.type === "Property" && parent.shorthand]);
            },
        });
    }

    for (const [name, offset, isShorthand] of identifiers) {
        if (shouldIdentifierSkipped(ctx, name)) {
            continue;
        }

        if (isShorthand) {
            yield [code.slice(prevEnd, offset + name.length), prevEnd];
            yield `: `;
        }
        else {
            yield [code.slice(prevEnd, offset), prevEnd, prevEnd ? void 0 : "startEnd"];
        }

        if (setupRefs.has(name)) {
            yield [name, offset];
            yield `.value`;
        }
        else {
            yield ["", offset];
            if (ctx.dollarVars.has(name)) {
                yield names.dollars;
            }
            else {
                ctx.accessVariable(name);
                yield names.ctx;
            }
            yield `.`;
            yield [name, offset];
        }

        prevEnd = offset + name.length;
    }

    if (prevEnd < code.length) {
        yield [code.slice(prevEnd), prevEnd, "startEnd"];
    }
}

function shouldIdentifierSkipped(ctx: TemplateCodegenContext, text: string) {
    return ctx.scopes.some((scope) => scope.has(text)) ||
        isGloballyAllowed(text) ||
        isLiteralWhitelisted(text) ||
        text === "require" ||
        text.startsWith("__VLS_");
}
