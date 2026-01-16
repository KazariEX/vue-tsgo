import { codeFeatures } from "../codeFeatures";
import { names } from "../names";
import { endOfLine, newLine, section } from "../utils";
import { generateSpreadMerge } from "../utils/merge";
import type { Code } from "../../types";
import type { ScriptCodegenContext } from "./context";
import type { ScriptCodegenOptions } from "./index";

export function* generateTemplate(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
    self?: string,
): Generator<Code> {
    yield* generateSetupExposed(options, ctx);
    yield* generateTemplateCtx(options, ctx, self);
    yield* generateTemplateComponents(options, ctx);
    yield* generateTemplateDirectives(options, ctx);

    if (options.templateAndStyleCodes.length) {
        yield* options.templateAndStyleCodes;
    }
}

function* generateSetupExposed(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
): Generator<Code> {
    const { vueCompilerOptions, exposed } = options;

    if (!exposed.size) {
        return;
    }
    ctx.generatedTypes.add(names.SetupExposed);

    yield `type ${names.SetupExposed} = import("${vueCompilerOptions.lib}").ShallowUnwrapRef<{${newLine}`;
    for (const bindingName of exposed) {
        yield `${bindingName}: typeof ${bindingName}${endOfLine}`;
    }
    yield `}>${endOfLine}`;
}

function* generateTemplateCtx(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
    self?: string,
): Generator<Code> {
    const { vueCompilerOptions, sourcePath, scriptSetupRanges, templateAndStyleTypes } = options;
    const exps: Code[] = [];
    const propTypes: string[] = [];
    const emitTypes: string[] = [];

    if (vueCompilerOptions.petiteVueExtensions.some((ext) => sourcePath.endsWith(ext))) {
        exps.push(`globalThis`);
    }
    if (self) {
        exps.push(`{} as InstanceType<__VLS_PickNotAny<typeof ${self}, new () => {}>>`);
    }
    else {
        exps.push(`{} as import("${vueCompilerOptions.lib}").ComponentPublicInstance`);
    }
    if (templateAndStyleTypes.has(names.StyleModules)) {
        exps.push(`{} as ${names.StyleModules}`);
    }

    if (scriptSetupRanges?.defineEmits) {
        emitTypes.push(`typeof ${scriptSetupRanges.defineEmits.name ?? names.emit}`);
    }
    if (scriptSetupRanges?.defineModel.length) {
        emitTypes.push(`typeof ${names.modelEmit}`);
    }
    if (emitTypes.length) {
        yield `type ${names.EmitProps} = __VLS_EmitsToProps<__VLS_NormalizeEmits<${emitTypes.join(` & `)}>>${endOfLine}`;
        exps.push(`{} as { $emit: ${emitTypes.join(` & `)} }`);
    }

    if (scriptSetupRanges?.defineProps) {
        propTypes.push(`typeof ${scriptSetupRanges.defineProps.name ?? names.props}`);
    }
    if (scriptSetupRanges?.defineModel.length) {
        propTypes.push(names.ModelProps);
    }
    if (emitTypes.length) {
        propTypes.push(names.EmitProps);
    }
    if (propTypes.length) {
        exps.push(`{} as { $props: ${propTypes.join(` & `)} }`);
        exps.push(`{} as ${propTypes.join(` & `)}`);
    }

    if (ctx.generatedTypes.has(names.SetupExposed)) {
        exps.push(`{} as ${names.SetupExposed}`);
    }

    yield `const ${names.ctx} = `;
    yield* generateSpreadMerge(...exps);
    yield endOfLine;
}

function* generateTemplateComponents(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
): Generator<Code> {
    const { vueCompilerOptions, script, scriptRanges } = options;
    const types: string[] = [];

    if (ctx.generatedTypes.has(names.SetupExposed)) {
        types.push(names.SetupExposed);
    }
    if (script && scriptRanges?.exportDefault?.options?.components) {
        const { components } = scriptRanges.exportDefault.options;
        yield `const ${names.componentsOption} = `;
        yield section(script, components.start, components.end, codeFeatures.verification);
        yield endOfLine;
        types.push(`typeof ${names.componentsOption}`);
    }

    yield `type ${names.LocalComponents} = ${types.length ? types.join(` & `) : `{}`}${endOfLine}`;
    yield `type ${names.GlobalComponents} = ${
        vueCompilerOptions.target >= 3.5
            ? `import("${vueCompilerOptions.lib}").GlobalComponents`
            : `import("${vueCompilerOptions.lib}").GlobalComponents & Pick<typeof import("${vueCompilerOptions.lib}"), "Transition" | "TransitionGroup" | "KeepAlive" | "Suspense" | "Teleport">`
    }${endOfLine}`;
    yield `let ${names.intrinsics}!: ${
        vueCompilerOptions.target >= 3.3
            ? `import("${vueCompilerOptions.lib}/jsx-runtime").JSX.IntrinsicElements`
            : `globalThis.JSX.IntrinsicElements`
    }${endOfLine}`;
}

function* generateTemplateDirectives(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
): Generator<Code> {
    const { vueCompilerOptions, script, scriptRanges } = options;
    const types: string[] = [];

    if (ctx.generatedTypes.has(names.SetupExposed)) {
        types.push(names.SetupExposed);
    }
    if (script && scriptRanges?.exportDefault?.options?.directives) {
        const { directives } = scriptRanges.exportDefault.options;
        yield `const ${names.directivesOption} = `;
        yield section(script, directives.start, directives.end, codeFeatures.verification);
        yield endOfLine;
        types.push(`__VLS_ResolveDirectives<typeof ${names.directivesOption}>`);
    }

    yield `type ${names.LocalDirectives} = ${types.length ? types.join(` & `) : `{}`}${endOfLine}`;
    yield `let ${names.directives}!: ${names.LocalDirectives} & import("${vueCompilerOptions.lib}").GlobalDirectives${endOfLine}`;
}
