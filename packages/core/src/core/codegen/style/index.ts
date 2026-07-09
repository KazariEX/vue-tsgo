import type { VueCompilerOptions } from "@vue/language-core";
import { codeFeatures } from "../codeFeatures";
import { createTemplateCodegenContext, type TemplateCodegenContext } from "../template/context";
import { generateInterpolation } from "../template/interpolation";
import { endOfLine } from "../utils";
import { generateStyleModules } from "./modules";
import type { IRStyle } from "../../parse/ir";
import type { Code } from "../../types";

export interface StyleCodegenOptions {
  vueCompilerOptions: VueCompilerOptions;
  styles: IRStyle[];
  setupConsts: Set<string>;
  setupRefs: Set<string>;
}

// eslint-disable-next-line ts/no-use-before-define
export { generate as generateStyle };

function generate(options: StyleCodegenOptions) {
  const ctx = createTemplateCodegenContext();
  const codegen = generateStyle(options, ctx);
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

function* generateStyle(
  options: StyleCodegenOptions,
  ctx: TemplateCodegenContext,
): Generator<Code> {
  const scope = ctx.scope();
  ctx.declare(...options.setupConsts);
  yield* generateStyleModules(options, ctx);
  yield* generateBindings(options, ctx);
  scope.end();
}

function* generateBindings(
  options: StyleCodegenOptions,
  ctx: TemplateCodegenContext,
): Generator<Code> {
  for (const style of options.styles) {
    for (const binding of style.bindings) {
      yield* generateInterpolation(
        options,
        ctx,
        style,
        binding.text,
        binding.offset,
        codeFeatures.verification,
        `(`,
        `)`,
      );
      yield endOfLine;
    }
  }
}
