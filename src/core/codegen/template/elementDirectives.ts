import CompilerDOM from "@vue/compiler-dom";
import { camelize, isBuiltInDirective } from "@vue/shared";
import { codeFeatures } from "../codeFeatures";
import { names } from "../names";
import { endOfLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { generateCamelized } from "../utils/camelized";
import { generateStringLiteralKey } from "../utils/stringLiteralKey";
import { generatePropExp } from "./elementProps";
import { generateInterpolation } from "./interpolation";
import { generateObjectProperty } from "./objectProperty";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateElementDirectives(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    node: CompilerDOM.ElementNode,
): Generator<Code> {
    for (const prop of node.props) {
        if (
            prop.type !== CompilerDOM.NodeTypes.DIRECTIVE ||
            prop.name === "slot" ||
            prop.name === "on" ||
            prop.name === "model" ||
            prop.name === "bind"
        ) {
            continue;
        }
        const boundary = yield* generateBoundary(
            "template",
            prop.loc.start.offset,
            prop.loc.end.offset,
            codeFeatures.verification,
        );
        yield `__VLS_asFunctionalDirective(`;
        yield* generateIdentifier(options, ctx, prop);
        yield `, {} as import("${options.vueCompilerOptions.lib}").ObjectDirective)(null!, { ...__VLS_directiveBindingRestFields, `;
        yield* generateArg(options, ctx, prop);
        yield* generateModifiers(options, ctx, prop);
        yield* generateValue(options, ctx, prop);
        yield ` }, null!, null!)`;
        yield boundary.end();
        yield endOfLine;
    }
}

function* generateIdentifier(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
    if (!options.vueCompilerOptions.checkUnknownDirectives || isBuiltInDirective(prop.name)) {
        yield `{} as any`;
        return;
    }

    const rawName = "v-" + prop.name;
    const boundary = yield* generateBoundary(
        "template",
        prop.loc.start.offset,
        prop.loc.start.offset + rawName.length,
        codeFeatures.verification,
    );
    yield names.directives;
    yield `.`;
    yield* generateCamelized(
        rawName,
        "template",
        prop.loc.start.offset,
        codeFeatures.verification,
    );
    yield boundary.end();
    ctx.accessVariable(camelize(rawName));
}

function* generateArg(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
    const { arg } = prop;
    if (arg?.type !== CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
        return;
    }

    const startOffset = arg.loc.start.offset + arg.loc.source.indexOf(arg.content);
    yield* generateBoundary(
        "template",
        startOffset,
        startOffset + arg.content.length,
        codeFeatures.verification,
        `arg`,
    );
    yield `: `;
    if (arg.isStatic) {
        yield* generateStringLiteralKey(
            arg.content,
            startOffset,
            codeFeatures.verification,
        );
    }
    else {
        yield* generateInterpolation(
            options,
            ctx,
            options.template,
            arg.content,
            startOffset,
            codeFeatures.verification,
            `(`,
            `)`,
        );
    }
    yield `, `;
}

export function* generateModifiers(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    prop: CompilerDOM.DirectiveNode,
    propertyName: string = "modifiers",
): Generator<Code> {
    const { modifiers } = prop;
    if (!modifiers.length) {
        return;
    }

    const startOffset = modifiers[0].loc.start.offset - 1;
    const endOffset = modifiers.at(-1)!.loc.end.offset;
    yield* generateBoundary(
        "template",
        startOffset,
        endOffset,
        codeFeatures.verification,
        propertyName,
    );
    yield `: { `;
    for (const mod of modifiers) {
        yield* generateObjectProperty(
            options,
            ctx,
            mod.content,
            mod.loc.start.offset,
            codeFeatures.verification,
        );
        yield `: true, `;
    }
    yield `}, `;
}

function* generateValue(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
    const { exp } = prop;
    if (exp?.type !== CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
        return;
    }

    yield* generateBoundary(
        "template",
        exp.loc.start.offset,
        exp.loc.end.offset,
        codeFeatures.verification,
        `value`,
    );
    yield `: `;
    yield* generatePropExp(options, ctx, prop, exp);
}
