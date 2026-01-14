import type { VueCompilerOptions } from "@vue/language-core";
import { codeFeatures } from "../codeFeatures";
import { names } from "../names";
import { endOfLine, newLine } from "../utils";
import { createTemplateCodegenContext, type TemplateCodegenContext } from "./context";
import { generateObjectProperty } from "./objectProperty";
import { generateTemplateChild } from "./templateChild";
import type { IRTemplate } from "../../parse/ir";
import type { Code } from "../../types";

export interface TemplateCodegenOptions {
    vueCompilerOptions: VueCompilerOptions;
    template: IRTemplate;
    setupConsts: Set<string>;
    setupRefs: Set<string>;
    hasDefineSlots?: boolean;
    propsAssignName?: string;
    slotsAssignName?: string;
    componentName: string;
    inheritAttrs: boolean;
}

// eslint-disable-next-line ts/no-use-before-define
export { generate as generateTemplate };

function generate(options: TemplateCodegenOptions) {
    const ctx = createTemplateCodegenContext();
    const codegen = generateTemplate(options, ctx);
    const codes: Code[] = [];

    for (const code of codegen) {
        if (typeof code === "object") {
            code[3] = ctx.resolveCodeFeatures(code[3]);
        }
        codes.push(code);
    }

    return {
        ...ctx,
        codes,
    };
}

function* generateTemplate(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
): Generator<Code> {
    const { vueCompilerOptions, template, propsAssignName, slotsAssignName } = options;

    const scope = ctx.scope();
    ctx.declare(...options.setupConsts);

    if (propsAssignName !== void 0) {
        ctx.declare(propsAssignName);
    }
    if (slotsAssignName !== void 0) {
        ctx.declare(slotsAssignName);
    }
    if (vueCompilerOptions.inferTemplateDollarSlots) {
        ctx.dollarVars.add("$slots");
    }
    if (vueCompilerOptions.inferTemplateDollarAttrs) {
        ctx.dollarVars.add("$attrs");
    }
    if (vueCompilerOptions.inferTemplateDollarRefs) {
        ctx.dollarVars.add("$refs");
    }
    if (vueCompilerOptions.inferTemplateDollarEl) {
        ctx.dollarVars.add("$el");
    }

    if (template.ast) {
        yield* generateTemplateChild(options, ctx, template.ast);
    }
    yield* ctx.generateHoistVariables();
    yield* generateSlots(options, ctx);
    yield* generateInheritedAttrs(ctx);
    yield* generateTemplateRefs(options, ctx);
    yield* generateRootEl(ctx);

    if (ctx.dollarVars.size) {
        yield `var ${names.dollars}!: {${newLine}`;
        if (ctx.dollarVars.has("$slots")) {
            const type = ctx.generatedTypes.has(names.Slots) ? names.Slots : `{}`;
            yield `$slots: ${type}${endOfLine}`;
        }
        if (ctx.dollarVars.has("$attrs")) {
            yield `$attrs: import("${vueCompilerOptions.lib}").ComponentPublicInstance["$attrs"]`;
            if (ctx.generatedTypes.has(names.InheritedAttrs)) {
                yield ` & ${names.InheritedAttrs}`;
            }
            yield endOfLine;
        }
        if (ctx.dollarVars.has("$refs")) {
            const type = ctx.generatedTypes.has(names.TemplateRefs) ? names.TemplateRefs : `{}`;
            yield `$refs: ${type}${endOfLine}`;
        }
        if (ctx.dollarVars.has("$el")) {
            const type = ctx.generatedTypes.has(names.RootEl) ? names.RootEl : `any`;
            yield `$el: ${type}${endOfLine}`;
        }
        yield `}${endOfLine}`;
    }

    scope.end();
}

function* generateSlots(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
): Generator<Code> {
    if (options.hasDefineSlots || !ctx.slots.length && !ctx.dynamicSlots.length) {
        return;
    }
    ctx.generatedTypes.add(names.Slots);

    yield `type ${names.Slots} = {}`;
    for (const { expVar, propsVar } of ctx.dynamicSlots) {
        yield `${newLine}& { [K in NonNullable<typeof ${expVar}>]?: (props: typeof ${propsVar}) => any }`;
    }
    for (const slot of ctx.slots) {
        yield `${newLine}& { `;
        if (slot.name && slot.offset !== void 0) {
            yield slot.name;
            yield* generateObjectProperty(
                options,
                ctx,
                slot.name,
                slot.offset,
                codeFeatures.none,
            );
        }
        else {
            yield `default`;
        }
        yield `?: (props: typeof ${slot.propsVar}) => any }`;
    }
    yield endOfLine;
}

function* generateInheritedAttrs(ctx: TemplateCodegenContext) {
    if (!ctx.inheritedAttrVars.size) {
        return;
    }
    ctx.generatedTypes.add(names.InheritedAttrs);

    yield `type ${names.InheritedAttrs} = Partial<${
        [...ctx.inheritedAttrVars].map((name) => `typeof ${name}`).join(` & `)
    }>`;
    yield endOfLine;
}

function* generateTemplateRefs(
    options: TemplateCodegenOptions,
    ctx: TemplateCodegenContext,
): Generator<Code> {
    if (!ctx.templateRefs.size) {
        return;
    }
    ctx.generatedTypes.add(names.TemplateRefs);

    yield `type ${names.TemplateRefs} = {}`;
    for (const [name, refs] of ctx.templateRefs) {
        yield `${newLine}& `;
        if (refs.length >= 2) {
            yield `(`;
        }
        for (let i = 0; i < refs.length; i++) {
            const { typeExp, offset } = refs[i];
            if (i) {
                yield ` | `;
            }
            yield `{ `;
            yield* generateObjectProperty(
                options,
                ctx,
                name,
                offset,
                codeFeatures.none,
            );
            yield `: ${typeExp} }`;
        }
        if (refs.length >= 2) {
            yield `)`;
        }
    }
    yield endOfLine;
}

function* generateRootEl(ctx: TemplateCodegenContext): Generator<Code> {
    if (!ctx.singleRootElTypes.size || ctx.singleRootNodes.has(null)) {
        return;
    }
    ctx.generatedTypes.add(names.RootEl);

    yield `type ${names.RootEl} = `;
    for (const type of ctx.singleRootElTypes) {
        yield `${newLine}| ${type}`;
    }
    yield endOfLine;
}
