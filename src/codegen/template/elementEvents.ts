import CompilerDOM from "@vue/compiler-dom";
import { camelize, capitalize } from "@vue/shared";
import { type Node, parseSync, type Program } from "oxc-parser";
import { codeFeatures } from "../codeFeatures";
import { endOfLine, identifierRE, newLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { generateCamelized } from "../utils/camelized";
import { generateInterpolation } from "./interpolation";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateElementEvents(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    node: CompilerDOM.ElementNode,
    componentVar: string,
    getCtxVar: () => string,
    getPropsVar: () => string,
): Generator<Code> {
    let emitVar: string | undefined;

    for (const prop of node.props) {
        if (
            prop.type === CompilerDOM.NodeTypes.DIRECTIVE && (
                prop.name === "on" &&
                prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION &&
                prop.arg.isStatic ||
                options.vueCompilerOptions.strictVModel &&
                prop.name === "model" && (
                    !prop.arg || prop.arg.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic
                )
            )
        ) {
            if (!emitVar) {
                emitVar = ctx.getInternalVariable();
                yield `let ${emitVar}!: __VLS_ResolveEmits<typeof ${componentVar}, typeof ${getCtxVar()}.emit>${endOfLine}`;
            }

            let source = prop.arg?.loc.source ?? "model-value";
            let start = prop.arg?.loc.start.offset;
            let propPrefix = "on-";
            let emitPrefix = "";
            if (prop.name === "model") {
                propPrefix = "onUpdate:";
                emitPrefix = "update:";
            }
            else if (source.startsWith("vue:")) {
                source = source.slice("vue:".length);
                start = start! + "vue:".length;
                propPrefix = "onVnode-";
                emitPrefix = "vnode-";
            }
            const propName = camelize(propPrefix + source);
            const emitName = emitPrefix + source;
            const camelizedEmitName = camelize(emitName);

            yield `const ${ctx.getInternalVariable()}: __VLS_NormalizeComponentEvent<typeof ${getPropsVar()}, typeof ${emitVar}, "${propName}", "${emitName}", "${camelizedEmitName}"> = ({${newLine}`;
            if (prop.name === "on") {
                yield* generateEventArg(options, source, start!, propPrefix.slice(0, -1));
                yield `: `;
                yield* generateEventExpression(options, ctx, prop);
            }
            else {
                yield `"${propName}": `;
                yield* generateModelEventExpression(options, ctx, prop);
            }
            yield `})${endOfLine}`;
        }
    }
}

export function* generateEventArg(
    options: TemplateCodegenOptions,
    name: string,
    start: number,
    prefix = "on",
    features?: CodeInformation,
): Generator<Code> {
    features ??= options.vueCompilerOptions.checkUnknownEvents
        ? codeFeatures.verification
        : codeFeatures.doNotReportTs2353AndTs2561;

    if (prefix.length) {
        name = capitalize(name);
    }
    if (identifierRE.test(camelize(name))) {
        const boundary = yield* generateBoundary("template", start, features);
        yield prefix;
        yield* generateCamelized(name, "template", start, { __combineToken: boundary.token });
        yield boundary.end(start + name.length);
    }
    else {
        const boundary = yield* generateBoundary("template", start, features);
        yield `"`;
        yield prefix;
        yield* generateCamelized(name, "template", start, { __combineToken: boundary.token });
        yield `"`;
        yield boundary.end(start + name.length);
    }
}

export function* generateEventExpression(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
    if (prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
        const { program: ast } = parseSync("dummy.ts", prop.exp.content, {
            sourceType: "module",
        });

        const isCompound = isCompoundExpression(ast);
        const interpolation = generateInterpolation(
            options,
            ctx,
            options.template,
            prop.exp.content,
            prop.exp.loc.start.offset,
            codeFeatures.verification,
            isCompound ? `` : `(`,
            isCompound ? `` : `)`,
        );

        if (isCompound) {
            yield `(...[$event]) => {${newLine}`;
            const scope = ctx.scope();
            ctx.declare("$event");
            yield* ctx.generateConditionGuards();
            yield* interpolation;
            yield endOfLine;
            scope.end();
            yield `}`;
        }
        else {
            yield* interpolation;
        }
    }
    else {
        yield `() => {}`;
    }
}

export function* generateModelEventExpression(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
    prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
    if (prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
        yield `(...[$event]) => {${newLine}`;
        yield* ctx.generateConditionGuards();
        yield* generateInterpolation(
            options,
            ctx,
            options.template,
            prop.exp.content,
            prop.exp.loc.start.offset,
            codeFeatures.verification,
        );
        yield ` = $event${endOfLine}`;
        yield `}`;
    }
    else {
        yield `() => {}`;
    }
}

function isCompoundExpression(ast: Program) {
    if (ast.body.length === 0) {
        return false;
    }
    if (ast.body.length === 1) {
        const node = ast.body[0];
        if (node.type === "ExpressionStatement") {
            const { expression } = node;
            return expression.type !== "ArrowFunctionExpression" && !isPropertyAccessOrIdentifier(expression);
        }
        else if (node.type === "FunctionDeclaration") {
            return false;
        }
    }
    return true;
}

function isPropertyAccessOrIdentifier(node: Node) {
    if (node.type === "Identifier") {
        return true;
    }
    if (node.type === "MemberExpression") {
        return isPropertyAccessOrIdentifier(node.object);
    }
    return false;
}
