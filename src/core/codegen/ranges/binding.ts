import { type Identifier, walk } from "oxc-walker";
import type { VueCompilerOptions } from "@vue/language-core";
import type { BindingPattern, BindingProperty, Node, ParamPattern, Program } from "oxc-parser";
import { getRange, isFunctionLike, type Range } from "./utils";

export function collectBindingRanges(ast: Program, vueCompilerOptions: VueCompilerOptions) {
    const bindings: Range[] = [];
    const components: Range[] = [];

    for (const node of ast.body) {
        switch (node.type) {
            case "VariableDeclaration": {
                for (const decl of node.declarations) {
                    bindings.push(
                        ...collectBindingIdentifiers(decl).map((i) => i.range),
                    );
                }
                break;
            }
            case "ClassDeclaration":
            case "FunctionDeclaration":
            case "TSEnumDeclaration": {
                if (node.id) {
                    bindings.push(getRange(node.id));
                }
                break;
            }
            case "ImportDeclaration": {
                if (node.importKind === "type") {
                    break;
                }
                const isVue = vueCompilerOptions.extensions.some((ext) => node.source.value.endsWith(ext));

                for (const specifier of node.specifiers) {
                    const range = getRange(specifier.local);

                    switch (specifier.type) {
                        case "ImportDefaultSpecifier": {
                            if (isVue) {
                                components.push(range);
                            }
                            else {
                                bindings.push(range);
                            }
                            break;
                        }
                        case "ImportNamespaceSpecifier": {
                            bindings.push(range);
                            break;
                        }
                        case "ImportSpecifier": {
                            if (specifier.importKind === "type") {
                                continue;
                            }
                            if (
                                isVue &&
                                specifier.imported.type === "Identifier" &&
                                specifier.imported.name === "default"
                            ) {
                                components.push(range);
                            }
                            else {
                                bindings.push(range);
                            }
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    return {
        bindings,
        components,
    };
}

export function collectBindingIdentifiers(node: Node) {
    const result: [Identifier, boolean][] = [];

    walk(node, {
        enter(node) {
            if (node.type === "VariableDeclarator") {
                result.push(...forEachBindingIdentifier(node.id));
                this.skip();
            }
            else if (isFunctionLike(node)) {
                for (const param of node.params) {
                    result.push(...forEachBindingIdentifier(param));
                }
                this.skip();
            }
        },
    });

    return result.map(([node, isRest]) => ({
        name: node.name,
        range: {
            start: node.start,
            // const foo: Foo = {};
            //       ^^^^^^^^
            end: node.start + node.name.length,
        },
        isRest,
    }));
}

function* forEachBindingIdentifier(
    node: Identifier | BindingPattern | BindingProperty | ParamPattern,
    rest = false,
): Generator<[Identifier, boolean]> {
    switch (node.type) {
        case "Identifier": {
            yield [node, rest];
            break;
        }
        case "Property": {
            yield* forEachBindingIdentifier(node.value);
            break;
        }
        case "RestElement": {
            yield* forEachBindingIdentifier(node.argument, true);
            break;
        }
        case "AssignmentPattern": {
            yield* forEachBindingIdentifier(node.left);
            break;
        }
        case "ArrayPattern": {
            for (const element of node.elements) {
                if (element) {
                    yield* forEachBindingIdentifier(element);
                }
            }
            break;
        }
        case "ObjectPattern": {
            for (const prop of node.properties) {
                yield* forEachBindingIdentifier(prop);
            }
            break;
        }
    }
}
