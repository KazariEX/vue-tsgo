import type { VueCompilerOptions } from "@vue/language-core";
import { codeFeatures } from "../codeFeatures";
import { names } from "../names";
import { endOfLine, newLine, section } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { createScriptCodegenContext, type ScriptCodegenContext } from "./context";
import { generateSetupBody, generateSetupGeneric, generateSetupImports } from "./setup";
import { generateTemplate } from "./template";
import type { IRBlock, IRScript, IRScriptSetup } from "../../parse/ir";
import type { Code } from "../../types";
import type { ExportDefaultRanges, ScriptRanges } from "../ranges/script";
import type { ScriptSetupRanges } from "../ranges/scriptSetup";

export interface ScriptCodegenOptions {
    vueCompilerOptions: VueCompilerOptions;
    sourcePath: string;
    script?: IRScript;
    scriptSetup?: IRScriptSetup;
    scriptRanges?: ScriptRanges;
    scriptSetupRanges?: ScriptSetupRanges;
    templateAndStyleCodes: Code[];
    templateAndStyleTypes: Set<string>;
    exposed: Set<string>;
}

// eslint-disable-next-line ts/no-use-before-define
export { generate as generateScript };

function generate(options: ScriptCodegenOptions) {
    const ctx = createScriptCodegenContext(options);
    const codegen = generateScript(options, ctx);

    return {
        ...ctx,
        codes: [...codegen],
    };
}

function* generateScript(
    options: ScriptCodegenOptions,
    ctx: ScriptCodegenContext,
): Generator<Code> {
    const { vueCompilerOptions, script, scriptSetup, scriptRanges, scriptSetupRanges } = options;

    // <script src="...">
    if (typeof script?.attrs.src === "object") {
        let { text, offset } = script.attrs.src;
        if (text.endsWith(".ts") && !text.endsWith(".d.ts")) {
            text = text.slice(0, -".ts".length) + ".js";
        }
        else if (text.endsWith(".tsx")) {
            text = text.slice(0, -".tsx".length) + ".jsx";
        }

        yield `import ${names.export} from `;
        const boundary = yield* generateBoundary(
            "main",
            offset,
            offset + text.length,
            codeFeatures.verification,
        );
        yield `"`;
        yield [
            text.slice(0, text.length),
            "main",
            offset,
            { __combineToken: boundary.token },
        ];
        yield text.slice(text.length);
        yield `"`;
        yield boundary.end();
        yield endOfLine;
        yield `export default {} as typeof ${names.export}${endOfLine}`;
    }
    // <script> + <script setup>
    else if (script && scriptSetup && scriptRanges && scriptSetupRanges) {
        yield* generateSetupImports(scriptSetup, scriptSetupRanges);

        // <script>
        let self: string | undefined;
        if (scriptRanges.exportDefault) {
            yield* generateScriptWithExportDefault(
                options,
                script,
                scriptRanges,
                scriptRanges.exportDefault,
                self = names.self,
            );
        }
        else {
            yield section(script, 0, script.content.length, codeFeatures.verification);
            yield `export default {} as typeof ${names.export}${endOfLine}`;
        }

        // <script setup>
        yield* generateExportDeclareEqual(scriptSetup, names.export);
        if (scriptSetup.attrs.generic) {
            yield* generateSetupGeneric(
                options,
                ctx,
                scriptSetup,
                scriptSetupRanges,
                scriptSetup.attrs.generic,
                generateSetupBody(
                    options,
                    ctx,
                    scriptSetup,
                    scriptSetupRanges,
                    generateTemplate(options, ctx, self),
                ),
            );
        }
        else {
            yield `await (async () => {${newLine}`;
            yield* generateSetupBody(
                options,
                ctx,
                scriptSetup,
                scriptSetupRanges,
                generateTemplate(options, ctx, self),
                [`return `],
            );
            yield `})()${endOfLine}`;
        }
    }
    // <script setup> only
    else if (scriptSetup && scriptSetupRanges) {
        yield* generateSetupImports(scriptSetup, scriptSetupRanges);

        if (scriptSetup.attrs.generic) {
            yield* generateExportDeclareEqual(scriptSetup, names.export);
            yield* generateSetupGeneric(
                options,
                ctx,
                scriptSetup,
                scriptSetupRanges,
                scriptSetup.attrs.generic,
                generateSetupBody(
                    options,
                    ctx,
                    scriptSetup,
                    scriptSetupRanges,
                    generateTemplate(options, ctx),
                ),
            );
        }
        else {
            yield* generateSetupBody(
                options,
                ctx,
                scriptSetup,
                scriptSetupRanges,
                generateTemplate(options, ctx),
                generateExportDeclareEqual(scriptSetup, names.export),
            );
        }
        yield `export default {} as typeof ${names.export}${endOfLine}`;
    }
    // <script> only
    else if (script && scriptRanges) {
        if (scriptRanges.exportDefault) {
            yield* generateScriptWithExportDefault(
                options,
                script,
                scriptRanges,
                scriptRanges.exportDefault,
                names.export,
                generateTemplate(options, ctx, names.export),
            );
        }
        else {
            yield section(script, 0, script.content.length, codeFeatures.verification);
            yield* generateExportDeclareEqual(script, names.export);
            yield `(await import("${vueCompilerOptions.lib}")).defineComponent({})${endOfLine}`;
            yield* generateTemplate(options, ctx, names.export);
            yield `export default {} as typeof ${names.export}${endOfLine}`;
        }
    }

    yield* ctx.localTypes.generate();
}

function* generateScriptWithExportDefault(
    options: ScriptCodegenOptions,
    script: IRScript,
    scriptRanges: ScriptRanges,
    exportDefault: ExportDefaultRanges,
    variableName: string,
    templateCodegen?: Iterable<Code>,
): Generator<Code> {
    const componentOptions = scriptRanges.exportDefault?.options;
    const { expression, isObjectLiteral } = componentOptions ?? exportDefault;
    const [wrapLeft, wrapRight] = isObjectLiteral ? options.vueCompilerOptions.optionsWrapper : [];

    yield section(script, 0, expression.start, codeFeatures.verification);
    yield `{} as typeof ${names.export}`;
    yield section(script, expression.end, exportDefault.end, codeFeatures.verification);
    yield endOfLine;

    if (templateCodegen) {
        yield* templateCodegen;
    }

    yield* generateExportDeclareEqual(script, variableName);
    if (wrapLeft && wrapRight) {
        yield wrapLeft;
        yield section(script, expression.start, expression.end, codeFeatures.verification);
        yield wrapRight;
    }
    else {
        yield section(script, expression.start, expression.end, codeFeatures.verification);
    }
    yield endOfLine;
    yield section(script, exportDefault.end, script.content.length, codeFeatures.verification);
}

function* generateExportDeclareEqual(block: IRBlock, name: string): Generator<Code> {
    yield `const `;
    const boundary = yield* generateBoundary(
        block.name,
        0,
        block.content.length,
        codeFeatures.doNotReportTs6133,
    );
    yield name;
    yield boundary.end();
    yield ` = `;
}
