import { walk } from "oxc-walker";
import type { VueCompilerOptions } from "@vue/language-core";
import type { Argument, CallExpression, Node } from "oxc-parser";
import { collectBindingIdentifiers, collectBindingRanges } from "./binding";
import { getClosestMultiLineCommentRange, getLeadingComments, getRange, isFunctionLike, isStatement, type Range } from "./utils";
import type { IRScriptSetup } from "../../parse/ir";

interface CallExpressionRange {
    callExp: Range;
    exp: Range;
    arg?: Range;
    typeArg?: Range;
}

interface DefineModel {
    localName?: Range;
    name?: Range;
    type?: Range;
    modifierType?: Range;
    runtimeType?: Range;
    defaultValue?: Range;
    required?: boolean;
    comments?: Range;
}

interface DefineProps extends CallExpressionRange {
    name?: string;
    destructured?: Set<string>;
    destructuredRest?: string;
    statement: Range;
}

interface DefineEmits extends CallExpressionRange {
    name?: string;
    statement: Range;
}

interface DefineSlots extends CallExpressionRange {
    name?: string;
    statement: Range;
}

interface DefineOptions {
    name?: string;
    inheritAttrs?: boolean;
}

interface UseTemplateRef extends CallExpressionRange {
    name?: string;
}

export type ScriptSetupRanges = ReturnType<typeof collectScriptSetupRanges>;

const tsCheckRE = /^\s*@ts-(?:no)?check(?:$|\s)/;

export function collectScriptSetupRanges(scriptSetup: IRScriptSetup, vueCompilerOptions: VueCompilerOptions) {
    const leadingCommentEndOffset = scriptSetup.ast.body.length
        ? getLeadingComments(scriptSetup.ast.body[0], scriptSetup.content, scriptSetup.comments)
            .findLast((c) => c.type === "Line" && tsCheckRE.test(c.value))
            ?.end ?? 0
        : 0;

    let importSectionEndOffset = 0;
    for (const node of scriptSetup.ast.body) {
        switch (node.type) {
            case "EmptyStatement":
            case "ExportAllDeclaration":
            case "ExportDefaultDeclaration":
            case "ExportNamedDeclaration":
            case "ImportDeclaration": {
                continue;
            }
        }

        const comments = getLeadingComments(node, scriptSetup.content, scriptSetup.comments);
        if (comments.length) {
            importSectionEndOffset = comments[0].start;
        }
        else {
            importSectionEndOffset = node.start;
        }
        break;
    }

    const { bindings, components } = collectBindingRanges(scriptSetup.ast, vueCompilerOptions);
    const defineModel: DefineModel[] = [];
    let defineProps: DefineProps | undefined;
    let withDefaults: CallExpressionRange | undefined;
    let defineEmits: DefineEmits | undefined;
    let defineSlots: DefineSlots | undefined;
    let defineExpose: CallExpressionRange | undefined;
    let defineOptions: DefineOptions | undefined;
    const useAttrs: CallExpressionRange[] = [];
    const useCssModule: CallExpressionRange[] = [];
    const useSlots: CallExpressionRange[] = [];
    const useTemplateRef: UseTemplateRef[] = [];

    const parents: Node[] = [];
    walk(scriptSetup.ast, {
        enter(node) {
            if (isFunctionLike(node)) {
                this.skip();
                return;
            }
            const parent = parents.at(-1)!;

            if (node.type === "CallExpression" && node.callee.type === "Identifier") {
                const calleeName = node.callee.name;

                if (vueCompilerOptions.macros.defineModel.includes(calleeName)) {
                    let localName: Range | undefined;
                    let propName: Argument | undefined;
                    let options: Argument | undefined;
                    let type: Range | undefined;
                    let modifierType: Range | undefined;
                    let runtimeType: Range | undefined;
                    let defaultValue: Range | undefined;
                    let required = false;

                    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
                        localName = getRange(parent.id);
                    }

                    if (node.typeArguments) {
                        if (node.typeArguments.params.length >= 1) {
                            type = getRange(node.typeArguments.params[0]);
                        }
                        if (node.typeArguments.params.length >= 2) {
                            modifierType = getRange(node.typeArguments.params[1]);
                        }
                    }

                    if (node.arguments.length >= 2) {
                        [propName, options] = node.arguments;
                    }
                    else if (node.arguments.length) {
                        const firstArg = node.arguments[0];
                        if (firstArg.type === "Literal" && typeof firstArg.value === "string") {
                            propName = firstArg;
                        }
                        else {
                            options = firstArg;
                        }
                    }

                    if (options && options.type === "ObjectExpression") {
                        for (const prop of options.properties) {
                            if (prop.type !== "Property" || prop.key.type !== "Identifier") {
                                continue;
                            }
                            if (prop.key.name === "type") {
                                runtimeType = getRange(prop.value);
                            }
                            else if (prop.key.name === "default") {
                                defaultValue = getRange(prop.value);
                            }
                            else if (
                                prop.key.name === "required" &&
                                prop.value.type === "Literal" &&
                                prop.value.raw === "true"
                            ) {
                                required = true;
                            }
                        }
                    }

                    let name: Range | undefined;
                    if (propName && propName.type === "Literal" && typeof propName.value === "string") {
                        name = getRange(propName);
                    }

                    defineModel.push({
                        localName,
                        name,
                        type,
                        modifierType,
                        runtimeType,
                        defaultValue,
                        required,
                        comments: getClosestMultiLineCommentRange(node, scriptSetup.content, scriptSetup.comments),
                    });
                }
                else if (vueCompilerOptions.macros.defineProps.includes(calleeName)) {
                    defineProps = {
                        ...parseCallExpressionAssignment(node, parent),
                        statement: getStatementRange(node, parents),
                    };

                    if (parent.type === "VariableDeclarator" && parent.id.type === "ObjectPattern") {
                        defineProps.destructured = new Set();
                        for (const { name, isRest } of collectBindingIdentifiers(parent)) {
                            if (isRest) {
                                defineProps.destructuredRest = name;
                            }
                            else {
                                defineProps.destructured.add(name);
                            }
                        }
                    }
                    else if (
                        parent.type === "CallExpression" &&
                        parent.callee.type === "Identifier" &&
                        parent.callee.name === "withDefaults"
                    ) {
                        const grandparent = parents.at(-2);
                        if (grandparent?.type === "VariableDeclarator" && grandparent.id.type === "Identifier") {
                            defineProps.name = grandparent.id.name;
                        }
                    }
                }
                else if (vueCompilerOptions.macros.withDefaults.includes(calleeName)) {
                    const [, arg] = node.arguments;
                    withDefaults = {
                        callExp: getRange(node),
                        exp: getRange(node.callee),
                        arg: arg ? getRange(arg) : void 0,
                    };
                }
                else if (vueCompilerOptions.macros.defineEmits.includes(calleeName)) {
                    defineEmits = {
                        ...parseCallExpressionAssignment(node, parent),
                        statement: getStatementRange(node, parents),
                    };
                }
                else if (vueCompilerOptions.macros.defineSlots.includes(calleeName)) {
                    defineSlots = {
                        ...parseCallExpressionAssignment(node, parent),
                        statement: getStatementRange(node, parents),
                    };
                }
                else if (vueCompilerOptions.macros.defineExpose.includes(calleeName)) {
                    defineExpose = parseCallExpression(node);
                }
                else if (vueCompilerOptions.macros.defineOptions.includes(calleeName)) {
                    defineOptions = {};

                    const firstArg = node.arguments[0];
                    if (firstArg?.type === "ObjectExpression") {
                        for (const prop of firstArg.properties) {
                            if (prop.type !== "Property" || prop.key.type !== "Identifier") {
                                continue;
                            }
                            if (
                                prop.key.name === "name" &&
                                prop.value.type === "Literal" &&
                                typeof prop.value.value === "string"
                            ) {
                                defineOptions.name = prop.value.value;
                            }
                            else if (
                                prop.key.name === "inheritAttrs" &&
                                prop.value.type === "Literal" &&
                                typeof prop.value.value === "boolean"
                            ) {
                                defineOptions.inheritAttrs = prop.value.value;
                            }
                        }
                    }
                }
                else if (vueCompilerOptions.composables.useAttrs.includes(calleeName)) {
                    useAttrs.push(parseCallExpression(node));
                }
                else if (vueCompilerOptions.composables.useCssModule.includes(calleeName)) {
                    useCssModule.push(parseCallExpression(node));
                }
                else if (vueCompilerOptions.composables.useSlots.includes(calleeName)) {
                    useSlots.push(parseCallExpression(node));
                }
                else if (vueCompilerOptions.composables.useTemplateRef.includes(calleeName)) {
                    useTemplateRef.push(parseCallExpressionAssignment(node, parent));
                }
            }
            parents.push(node);
        },
        leave() {
            parents.pop();
        },
    });

    return {
        leadingCommentEndOffset,
        importSectionEndOffset,
        bindings,
        components,
        defineModel,
        defineProps,
        withDefaults,
        defineEmits,
        defineSlots,
        defineExpose,
        defineOptions,
        useAttrs,
        useCssModule,
        useSlots,
        useTemplateRef,
    };
}

function parseCallExpression(node: CallExpression): CallExpressionRange {
    return {
        callExp: getRange(node),
        exp: getRange(node.callee),
        arg: node.arguments.length ? getRange(node.arguments[0]) : void 0,
        typeArg: node.typeArguments?.params.length ? getRange(node.typeArguments.params[0]) : void 0,
    };
}

function parseCallExpressionAssignment(node: CallExpression, parent: Node) {
    return {
        name: parent.type === "VariableDeclarator" && parent.id.type === "Identifier"
            ? parent.id.name
            : void 0,
        ...parseCallExpression(node),
    };
}

function getStatementRange(node: Node, parents: Node[]) {
    let statementRange: Range | undefined;
    for (let i = parents.length - 1; i >= 0; i--) {
        const parent = parents[i];
        if (isStatement(parent)) {
            walk(parent, {
                // eslint-disable-next-line no-loop-func
                enter(node) {
                    const range = getRange(node);
                    statementRange ??= range;
                    statementRange.end = range.end;
                    if (node !== parent) {
                        this.skip();
                    }
                },
            });
            break;
        }
    }
    return statementRange ?? getRange(node);
}
