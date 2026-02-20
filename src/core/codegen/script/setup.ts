import { camelize } from "@vue/shared";
import { codeFeatures } from "../codeFeatures";
import { names } from "../names";
import { endOfLine, identifierRE, newLine, section } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { createBlockTransform } from "../utils/transform";
import { generateComponent } from "./component";
import type { IRBlock, IRBlockAttr, IRScriptSetup } from "../../parse/ir";
import type { Code } from "../../types";
import type { ScriptSetupRanges } from "../ranges/scriptSetup";
import type { Range } from "../ranges/utils";
import type { ScriptCodegenContext } from "./context";
import type { ScriptCodegenOptions } from "./index";

export function* generateSetupImports(
    scriptSetup: IRScriptSetup,
    scriptSetupRanges: ScriptSetupRanges,
): Generator<Code> {
    yield [
        scriptSetup.content.slice(
            0,
            Math.max(scriptSetupRanges.leadingCommentEndOffset, scriptSetupRanges.importSectionEndOffset),
        ),
        scriptSetup.name,
        0,
        codeFeatures.verification,
    ];
}

export function* generateSetupGeneric(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
    scriptSetup: IRScriptSetup,
    scriptSetupRanges: ScriptSetupRanges,
    generic: IRBlockAttr,
    body: Iterable<Code>,
): Generator<Code> {
    yield `(`;
    if (typeof generic === "object") {
        yield `<`;
        yield [generic.text, "main", generic.offset, codeFeatures.verification];
        if (!generic.text.endsWith(",")) {
            yield `,`;
        }
        yield `>`;
    }
    yield `(${newLine}`
        + `  ${names.props}: NonNullable<Awaited<typeof ${names.setup}>>["props"],${newLine}`
        + `  ${names.ctx}?: ${ctx.localTypes.PrettifyLocal}<Pick<NonNullable<Awaited<typeof ${names.setup}>>, "attrs" | "emit" | "slots">>,${newLine}`
        + `  ${names.exposed}?: NonNullable<Awaited<typeof ${names.setup}>>["expose"],${newLine}`
        + `  ${names.setup} = (async () => {${newLine}`;

    yield* body;

    const { vueCompilerOptions } = options;
    const propTypes: string[] = [];
    const emitTypes: string[] = [];

    if (ctx.generatedTypes.has(names.PublicProps)) {
        propTypes.push(names.PublicProps);
    }
    if (scriptSetupRanges.defineProps?.arg) {
        yield `const ${names.propsOption} = `;
        yield section(
            scriptSetup,
            scriptSetupRanges.defineProps.arg.start,
            scriptSetupRanges.defineProps.arg.end,
            codeFeatures.verification,
        );
        yield endOfLine;

        propTypes.push(
            `import("${vueCompilerOptions.lib}").${
                vueCompilerOptions.target >= 3.3 ? `ExtractPublicPropTypes` : `ExtractPropTypes`
            }<typeof ${names.propsOption}>`,
        );
    }
    if (scriptSetupRanges.defineEmits || scriptSetupRanges.defineModel.length) {
        propTypes.push(names.EmitProps);
    }
    if (options.templateAndStyleTypes.has(names.InheritedAttrs)) {
        propTypes.push(names.InheritedAttrs);
    }
    if (scriptSetupRanges.defineEmits) {
        emitTypes.push(`typeof ${scriptSetupRanges.defineEmits.name ?? names.emit}`);
    }
    if (scriptSetupRanges.defineModel.length) {
        emitTypes.push(`typeof ${names.modelEmit}`);
    }

    yield `return {} as {${newLine}`;
    yield `  props: `;
    yield vueCompilerOptions.target >= 3.4
        ? `import("${vueCompilerOptions.lib}").PublicProps`
        : ["VNodeProps", "AllowedComponentProps", "ComponentCustomProps"]
            .map((type) => `import("${vueCompilerOptions.lib}").${type}`)
            .join(` & `);
    if (propTypes.length) {
        yield ` & ${ctx.localTypes.PrettifyLocal}<${propTypes.join(` & `)}>`;
    }
    yield ` & (typeof globalThis extends { __VLS_PROPS_FALLBACK: infer P } ? P : {})${endOfLine}`;
    yield `  expose: (exposed: `;
    yield scriptSetupRanges.defineExpose
        ? `import("${vueCompilerOptions.lib}").ShallowUnwrapRef<typeof ${names.exposed}>`
        : `{}`;
    if (
        options.vueCompilerOptions.inferComponentDollarRefs &&
        options.templateAndStyleTypes.has(names.TemplateRefs)
    ) {
        yield ` & { $refs: ${names.TemplateRefs} }`;
    }
    if (
        options.vueCompilerOptions.inferComponentDollarEl &&
        options.templateAndStyleTypes.has(names.RootEl)
    ) {
        yield ` & { $el: ${names.RootEl} }`;
    }
    yield `) => void${endOfLine}`;
    yield `  attrs: any${endOfLine}`;
    yield `  slots: ${hasSlotsType(options) ? names.Slots : `{}`}${endOfLine}`;
    yield `  emit: ${emitTypes.length ? emitTypes.join(` & `) : `{}`}${endOfLine}`;
    yield `}${endOfLine}`;
    yield `})(),${newLine}`;
    yield `) => ({} as import("${vueCompilerOptions.lib}").VNode & { __ctx?: Awaited<typeof ${names.setup}> }))${endOfLine}`;
}

export function* generateSetupBody(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
    scriptSetup: IRScriptSetup,
    scriptSetupRanges: ScriptSetupRanges,
    body: Iterable<Code>,
    output?: Iterable<Code>,
) {
    const { insert, replace, generate } = createBlockTransform(
        scriptSetup,
        Math.max(scriptSetupRanges.leadingCommentEndOffset, scriptSetupRanges.importSectionEndOffset),
        scriptSetup.content.length,
        codeFeatures.verification,
    );

    if (scriptSetupRanges.defineProps) {
        const { name, statement, callExp, typeArg } = scriptSetupRanges.defineProps;
        for (const replacement of generateDefineWithType(
            scriptSetup,
            statement,
            scriptSetupRanges.withDefaults?.callExp ?? callExp,
            typeArg,
            name,
            names.props,
            names.Props,
        )) {
            replace(...replacement);
        }
    }
    if (scriptSetupRanges.defineEmits) {
        const { name, statement, callExp, typeArg } = scriptSetupRanges.defineEmits;
        for (const replacement of generateDefineWithType(
            scriptSetup,
            statement,
            callExp,
            typeArg,
            name,
            names.emit,
            names.Emit,
        )) {
            replace(...replacement);
        }
    }
    if (scriptSetupRanges.defineSlots) {
        const { name, statement, callExp, typeArg } = scriptSetupRanges.defineSlots;
        for (const replacement of generateDefineWithType(
            scriptSetup,
            statement,
            callExp,
            typeArg,
            name,
            names.slots,
            names.Slots,
        )) {
            replace(...replacement);
        }
    }
    if (scriptSetupRanges.defineExpose) {
        const { callExp, arg, typeArg } = scriptSetupRanges.defineExpose;
        if (typeArg) {
            insert(
                callExp.start,
                `let ${names.exposed}!: `,
                section(scriptSetup, typeArg.start, typeArg.end, codeFeatures.verification),
                endOfLine,
            );
            replace(typeArg.start, typeArg.end, `typeof ${names.exposed}`);
        }
        else if (arg) {
            insert(
                callExp.start,
                `const ${names.exposed} = `,
                section(scriptSetup, arg.start, arg.end, codeFeatures.verification),
                endOfLine,
            );
            replace(arg.start, arg.end, names.exposed);
        }
        else {
            insert(callExp.start, `const ${names.exposed} = {}${endOfLine}`);
        }
    }
    if (options.vueCompilerOptions.inferTemplateDollarAttrs) {
        for (const { callExp } of scriptSetupRanges.useAttrs) {
            insert(callExp.start, `(`);
            insert(callExp.end, ` as typeof ${names.dollars}.$attrs)`);
        }
    }
    for (const { callExp, exp, arg } of scriptSetupRanges.useCssModule) {
        insert(callExp.start, `(`);
        const type = options.templateAndStyleTypes.has(names.StyleModules)
            ? names.StyleModules
            : `{}`;
        if (arg) {
            insert(
                callExp.end,
                ` as Omit<${type}, "$style">[`,
                section(scriptSetup, arg.start, arg.end, codeFeatures.verification),
                `])`,
            );
            replace(arg.start, arg.end, `{} as any`);
        }
        else {
            insert(
                callExp.end,
                ` as ${type}[`,
                ...generateBoundary(
                    scriptSetup.name,
                    exp.start,
                    exp.end,
                    codeFeatures.verification,
                    `"$style"`,
                ),
                `])`,
            );
        }
    }
    if (options.vueCompilerOptions.inferTemplateDollarSlots) {
        for (const { callExp } of scriptSetupRanges.useSlots) {
            insert(callExp.start, `(`);
            insert(callExp.end, ` as typeof ${names.dollars}.$slots)`);
        }
    }
    for (const { callExp, arg, typeArg } of scriptSetupRanges.useTemplateRef) {
        if (typeArg) {
            continue;
        }
        insert(callExp.start, `(`);
        insert(
            callExp.end,
            ` as Readonly<import("${options.vueCompilerOptions.lib}").ShallowRef<`,
            ...arg
                ? [
                    names.TemplateRefs,
                    `[`,
                    section(scriptSetup, arg.start, arg.end, codeFeatures.verification),
                    `]`,
                ]
                : [`unknown`],
            ` | null>>)`,
        );
        if (arg) {
            replace(arg.start, arg.end, `{} as any`);
        }
    }

    yield* generate();
    yield* generateMacros(options);
    yield* generateModels(scriptSetup, scriptSetupRanges);
    yield* generatePublicProps(options, ctx, scriptSetup, scriptSetupRanges);
    yield* body;

    if (output) {
        if (hasSlotsType(options)) {
            yield `const ${names.base} = `;
            yield* generateComponent(options, ctx, scriptSetup, scriptSetupRanges);
            yield endOfLine;
            yield* output;
            yield `{} as ${ctx.localTypes.WithSlots}<typeof ${names.base}, ${names.Slots}>${endOfLine}`;
        }
        else {
            yield* output;
            yield* generateComponent(options, ctx, scriptSetup, scriptSetupRanges);
            yield endOfLine;
        }
    }
}

function* generateDefineWithType(
    scriptSetup: IRScriptSetup,
    statement: Range,
    callExp: Range,
    typeArg: Range | undefined,
    name: string | undefined,
    defaultName: string,
    typeName: string,
): Generator<[number, number, ...Code[]]> {
    if (typeArg !== void 0) {
        yield [
            statement.start,
            statement.start,
            `type ${typeName} = `,
            section(scriptSetup, typeArg.start, typeArg.end, codeFeatures.verification),
            endOfLine,
        ];
        yield [
            typeArg.start,
            typeArg.end,
            typeName,
        ];
    }
    if (name === void 0) {
        if (statement.start === callExp.start && statement.end === callExp.end) {
            yield [
                callExp.start,
                callExp.start,
                `const ${defaultName} = `,
            ];
        }
        else if (typeArg !== void 0) {
            yield [
                statement.start,
                typeArg.start,
                `const ${defaultName} = `,
                section(scriptSetup, callExp.start, typeArg.start, codeFeatures.verification),
            ];
            yield [
                typeArg.end,
                callExp.end,
                section(scriptSetup, typeArg.end, callExp.end, codeFeatures.verification),
                endOfLine,
                section(scriptSetup, statement.start, callExp.start, codeFeatures.verification),
                defaultName,
            ];
        }
        else {
            yield [
                statement.start,
                callExp.end,
                `const ${defaultName} = `,
                section(scriptSetup, callExp.start, callExp.end, codeFeatures.verification),
                endOfLine,
                section(scriptSetup, statement.start, callExp.start, codeFeatures.verification),
                defaultName,
            ];
        }
    }
    else if (!identifierRE.test(name)) {
        yield [
            statement.start,
            callExp.start,
            `const ${defaultName} = `,
        ];
        yield [
            statement.end,
            statement.end,
            endOfLine,
            section(scriptSetup, statement.start, callExp.start, codeFeatures.verification),
            defaultName,
        ];
    }
}

function* generateMacros(options: ScriptCodegenOptions): Generator<Code> {
    if (options.vueCompilerOptions.target >= 3.3) {
        yield `// @ts-ignore${newLine}`;
        yield `declare const { `;
        for (const macro of Object.keys(options.vueCompilerOptions.macros)) {
            if (!options.exposed.has(macro)) {
                yield `${macro}, `;
            }
        }
        yield `}: typeof import("${options.vueCompilerOptions.lib}")${endOfLine}`;
    }
}

function* generateModels(
    scriptSetup: IRScriptSetup,
    scriptSetupRanges: ScriptSetupRanges,
): Generator<Code> {
    if (!scriptSetupRanges.defineModel.length) {
        return;
    }

    const defaultCodes: string[] = [];
    const propCodes: Generator<Code>[] = [];
    const emitCodes: Generator<Code>[] = [];

    for (const defineModel of scriptSetupRanges.defineModel) {
        const propName = defineModel.name
            ? camelize(getRangeText(scriptSetup, defineModel.name).slice(1, -1))
            : "modelValue";

        let modelType: string;
        if (defineModel.type) {
            modelType = getRangeText(scriptSetup, defineModel.type);
        }
        else if (defineModel.runtimeType && defineModel.localName) {
            modelType = `typeof ${getRangeText(scriptSetup, defineModel.localName)}["value"]`;
        }
        else if (defineModel.defaultValue && propName) {
            modelType = `typeof ${names.defaultModels}["${propName}"]`;
        }
        else {
            modelType = `any`;
        }

        if (defineModel.defaultValue) {
            defaultCodes.push(
                `"${propName}": ${getRangeText(scriptSetup, defineModel.defaultValue)},${newLine}`,
            );
        }

        propCodes.push(generateModelProp(scriptSetup, defineModel, propName, modelType));
        emitCodes.push(generateModelEmit(defineModel, propName, modelType));
    }

    if (defaultCodes.length) {
        yield `const ${names.defaultModels} = {${newLine}`;
        yield* defaultCodes;
        yield `}${endOfLine}`;
    }

    yield `type ${names.ModelProps} = {${newLine}`;
    for (const codes of propCodes) {
        yield* codes;
    }
    yield `}${endOfLine}`;

    yield `type ${names.ModelEmit} = {${newLine}`;
    for (const codes of emitCodes) {
        yield* codes;
    }
    yield `}${endOfLine}`;
    yield `const ${names.modelEmit} = defineEmits<${names.ModelEmit}>()${endOfLine}`;
}

function* generateModelProp(
    scriptSetup: IRScriptSetup,
    defineModel: ScriptSetupRanges["defineModel"][number],
    propName: string,
    modelType: string,
): Generator<Code> {
    if (defineModel.comments) {
        yield scriptSetup.content.slice(defineModel.comments.start, defineModel.comments.end);
        yield newLine;
    }

    if (defineModel.name) {
        yield camelize(getRangeText(scriptSetup, defineModel.name));
    }
    else {
        yield propName;
    }

    yield defineModel.required ? `: ` : `?: `;
    yield modelType;
    yield endOfLine;

    if (defineModel.modifierType) {
        const modifierName = `${propName === "modelValue" ? "model" : propName}Modifiers`;
        const modifierType = getRangeText(scriptSetup, defineModel.modifierType);
        yield `"${modifierName}"?: Partial<Record<${modifierType}, true>>${endOfLine}`;
    }
}

function* generateModelEmit(
    defineModel: ScriptSetupRanges["defineModel"][number],
    propName: string,
    modelType: string,
): Generator<Code> {
    yield `"update:${propName}": [value: `;
    yield modelType;
    if (!defineModel.required && !defineModel.defaultValue) {
        yield ` | undefined`;
    }
    yield `]${endOfLine}`;
}

function* generatePublicProps(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
    scriptSetup: IRScriptSetup,
    scriptSetupRanges: ScriptSetupRanges,
): Generator<Code> {
    if (scriptSetupRanges.defineProps?.typeArg && scriptSetupRanges.withDefaults?.arg) {
        yield `const ${names.defaults} = `;
        yield section(
            scriptSetup,
            scriptSetupRanges.withDefaults.arg.start,
            scriptSetupRanges.withDefaults.arg.end,
            codeFeatures.verification,
        );
        yield endOfLine;
    }

    const propTypes: string[] = [];
    if (options.vueCompilerOptions.jsxSlots && hasSlotsType(options)) {
        propTypes.push(`${ctx.localTypes.PropsChildren}<${names.Slots}>`);
    }
    if (scriptSetupRanges.defineProps?.typeArg) {
        propTypes.push(names.Props);
    }
    if (scriptSetupRanges.defineModel.length) {
        propTypes.push(names.ModelProps);
    }
    if (propTypes.length) {
        yield `type ${names.PublicProps} = ${propTypes.join(` & `)}${endOfLine}`;
        ctx.generatedTypes.add(names.PublicProps);
    }
}

function getRangeText(block: IRBlock, range: Range) {
    return block.content.slice(range.start, range.end);
}

function hasSlotsType(options: ScriptCodegenOptions) {
    return !!(
        options.scriptSetupRanges?.defineSlots
        || options.templateAndStyleTypes.has(names.Slots)
    );
}
