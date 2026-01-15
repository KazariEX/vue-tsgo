
import type { VueCompilerOptions } from "@vue/language-core";
import type { ObjectExpression } from "oxc-parser";
import { collectBindingRanges } from "./binding";
import { getClosestMultiLineCommentRange, getRange, type Range } from "./utils";
import type { IRScript } from "../../parse/ir";

export interface ExportDefaultRanges extends Range {
    isObjectLiteral: boolean;
    expression: Range;
    options?: {
        isObjectLiteral: boolean;
        expression: Range;
        args: Range;
        components?: Range;
        directives?: Range;
        name?: Range;
        inheritAttrs?: boolean;
    };
}

export type ScriptRanges = ReturnType<typeof collectScriptRanges>;

export function collectScriptRanges(script: IRScript, vueCompilerOptions: VueCompilerOptions) {
    let exportDefault: ExportDefaultRanges | undefined;
    const { bindings, components } = collectBindingRanges(script.ast, vueCompilerOptions);

    for (const node of script.ast.body) {
        if (node.type !== "ExportDefaultDeclaration") {
            continue;
        }

        let exp = node.declaration;
        let obj: ObjectExpression | undefined;
        let options: ExportDefaultRanges["options"];

        while (exp.type === "TSAsExpression" || exp.type === "ParenthesizedExpression") {
            exp = exp.expression;
        }

        if (exp.type === "ObjectExpression") {
            obj = exp;
        }
        else if (exp.type === "CallExpression" && exp.arguments.length) {
            const firstArg = exp.arguments[0];
            if (firstArg.type === "ObjectExpression") {
                obj = firstArg;
            }
        }

        if (obj) {
            let components: Range | undefined;
            let directives: Range | undefined;
            let name: Range | undefined;
            let inheritAttrs: boolean | undefined;

            for (const prop of obj.properties) {
                if (prop.type !== "Property" || prop.key.type !== "Identifier") {
                    continue;
                }

                if (prop.key.name === "components" && prop.value.type === "ObjectExpression") {
                    components = getRange(prop.value);
                }
                else if (prop.key.name === "directives" && prop.value.type === "ObjectExpression") {
                    directives = getRange(prop.value);
                }
                else if (
                    prop.key.name === "name" &&
                    prop.value.type === "Literal" &&
                    typeof prop.value.value === "string"
                ) {
                    name = getRange(prop.value);
                }
                else if (
                    prop.key.name === "inheritAttrs" &&
                    prop.value.type === "Literal" &&
                    typeof prop.value.value === "boolean"
                ) {
                    inheritAttrs = prop.value.value;
                }
            }

            options = {
                isObjectLiteral: exp.type === "ObjectExpression",
                expression: getRange(exp),
                args: getRange(obj),
                components,
                directives,
                name,
                inheritAttrs,
            };
        }

        exportDefault = {
            ...getRange(node),
            isObjectLiteral: node.declaration.type === "ObjectExpression",
            expression: getRange(node.declaration),
            options,
        };

        const comment = getClosestMultiLineCommentRange(node, script.content, script.comments);
        if (comment) {
            exportDefault.start = comment.start;
        }
        break;
    }

    return {
        exportDefault,
        bindings,
        components,
    };
}
