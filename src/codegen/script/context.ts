import { getLocalTypesGenerator } from "@vue/language-core/lib/codegen/localTypes";
import type { ScriptCodegenOptions } from "./index";

export type ScriptCodegenContext = ReturnType<typeof createScriptCodegenContext>;

export function createScriptCodegenContext(options: ScriptCodegenOptions) {
    return {
        generatedTypes: new Set<string>(),
        localTypes: getLocalTypesGenerator(options.vueCompilerOptions),
    };
}
