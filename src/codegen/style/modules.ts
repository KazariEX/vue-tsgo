import { names } from "../names";
import { endOfLine, newLine } from "../utils";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "../template/context";
import type { StyleCodegenOptions } from "./index";

export function* generateStyleModules(
    options: StyleCodegenOptions,
    ctx: TemplateCodegenContext,
): Generator<Code> {
    const { vueCompilerOptions, styles } = options;

    const styleModules = styles.filter((style) => style.attrs.module);
    if (!styleModules.length) {
        return;
    }
    ctx.generatedTypes.add(names.StyleModules);

    yield `type ${names.StyleModules} = {${newLine}`;
    for (const style of styleModules) {
        if (style.attrs.module === true) {
            yield `$style`;
        }
        else {
            yield style.attrs.module.text;
        }
        yield `: `;
        if (!vueCompilerOptions.strictCssModules) {
            yield `Record<string, string> & `;
        }
        yield `__VLS_PrettifyGlobal<{}`;
        for (const className of style.classNames) {
            yield `${newLine} & { "`;
            yield className.text.slice(1);
            yield `": string }`;
        }
        yield `>${endOfLine}`;
    }
    yield `}${endOfLine}`;
}
