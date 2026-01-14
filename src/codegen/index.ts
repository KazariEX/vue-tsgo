import { posix as path } from "node:path";
import { camelize, capitalize } from "@vue/shared";
import type { VueCompilerOptions } from "@vue/language-core";
import { createCompilerOptionsResolver, parseLocalCompilerOptions } from "../compilerOptions";
import { collectScriptRanges } from "./ranges/script";
import { collectScriptSetupRanges } from "./ranges/scriptSetup";
import { generateScript } from "./script";
import { generateStyle } from "./style";
import { generateTemplate } from "./template";
import type { IR } from "../parse/ir";

export interface CodegenResult {

}

export function generate(
    vueCompilerOptions: VueCompilerOptions,
    ir: IR,
): CodegenResult {
    // #region vueCompilerOptions
    const options = parseLocalCompilerOptions(ir.comments);
    if (options) {
        const resolver = createCompilerOptionsResolver();
        resolver.add(options, path.dirname(ir.fileName));
        vueCompilerOptions = resolver.resolve(vueCompilerOptions);
    }
    // #endregion

    // #region scriptRanges
    const scriptRanges = ir.script && collectScriptRanges(ir.script);
    // #endregion

    // #region scriptSetupRanges
    const scriptSetupRanges = ir.scriptSetup && collectScriptSetupRanges(ir.scriptSetup, vueCompilerOptions);
    // #endregion

    // #region setupConsts
    const setupConsts = new Set<string>();
    if (ir.scriptSetup && scriptSetupRanges) {
        for (const range of scriptSetupRanges.components) {
            setupConsts.add(ir.scriptSetup.content.slice(range.start, range.end));
        }
        if (ir.script && scriptRanges) {
            for (const range of scriptRanges.components) {
                setupConsts.add(ir.script.content.slice(range.start, range.end));
            }
        }
    }
    if (scriptSetupRanges?.defineProps) {
        const { destructured, destructuredRest } = scriptSetupRanges.defineProps;
        if (destructured) {
            for (const name of destructured) {
                setupConsts.add(name);
            }
        }
        if (destructuredRest) {
            setupConsts.add(destructuredRest);
        }
    }
    // #endregion

    // #region setupRefs
    const setupRefs = new Set(
        scriptSetupRanges?.useTemplateRef.map(({ name }) => name).filter((name) => name !== void 0),
    );
    // #endregion

    // #region inheritAttrs
    const inheritAttrs = (
        scriptSetupRanges?.defineOptions?.inheritAttrs ?? scriptRanges?.exportDefault?.options?.inheritAttrs
    ) !== false;
    // #endregion

    // #region componentName
    let componentName: string;
    if (ir.script && scriptRanges?.exportDefault?.options?.name) {
        const { name } = scriptRanges.exportDefault.options;
        componentName = ir.script.content.slice(name.start + 1, name.end - 1);
    }
    else if (ir.scriptSetup && scriptSetupRanges?.defineOptions?.name) {
        componentName = scriptSetupRanges.defineOptions.name;
    }
    else {
        componentName = path.basename(ir.fileName, path.extname(ir.fileName));
    }
    componentName = capitalize(camelize(componentName));
    // #endregion

    // #region generatedTemplate
    const generatedTemplate = ir.template && !vueCompilerOptions.skipTemplateCodegen
        ? generateTemplate({
            vueCompilerOptions,
            template: ir.template,
            setupConsts,
            setupRefs,
            hasDefineSlots: scriptSetupRanges?.defineSlots !== void 0,
            propsAssignName: scriptSetupRanges?.defineProps?.name,
            slotsAssignName: scriptSetupRanges?.defineSlots?.name,
            componentName,
            inheritAttrs,
        })
        : void 0;
    // #endregion

    // #region generatedStyle
    const generatedStyle = ir.styles.length && !vueCompilerOptions.skipTemplateCodegen
        ? generateStyle({
            vueCompilerOptions,
            styles: ir.styles,
            setupConsts,
            setupRefs,
        })
        : void 0;
    // #endregion

    // #region declaredVariables
    const declaredVariables = new Set<string>();
    if (ir.scriptSetup && scriptSetupRanges) {
        for (const range of scriptSetupRanges.bindings) {
            const name = ir.scriptSetup.content.slice(range.start, range.end);
            declaredVariables.add(name);
        }
    }
    if (ir.script && scriptRanges) {
        for (const range of scriptRanges.bindings) {
            const name = ir.script.content.slice(range.start, range.end);
            declaredVariables.add(name);
        }
    }
    // #endregion

    // #region setupExposed
    const setupExposed = new Set<string>();
    for (const name of [
        ...generatedTemplate?.accessedVars ?? [],
        ...generatedTemplate?.dollarVars ?? [],
    ]) {
        if (declaredVariables.has(name)) {
            setupExposed.add(name);
        }
    }
    for (const component of ir.template?.ast.components ?? []) {
        for (const name of new Set([camelize(component), capitalize(camelize(component))])) {
            if (declaredVariables.has(name)) {
                setupExposed.add(name);
            }
        }
    }
    // #endregion

    // #region generatedScript
    const generatedScript = generateScript({
        vueCompilerOptions,
        fileName: ir.fileName,
        script: ir.script,
        scriptSetup: ir.scriptSetup,
        scriptRanges,
        scriptSetupRanges,
        templateAndStyleCodes: [
            ...generatedTemplate?.codes ?? [],
            ...generatedStyle?.codes ?? [],
        ],
        templateAndStyleTypes: new Set([
            ...generatedTemplate?.generatedTypes ?? [],
            ...generatedStyle?.generatedTypes ?? [],
        ]),
        exposed: setupExposed,
    });
    // #endregion

    return {};
}
