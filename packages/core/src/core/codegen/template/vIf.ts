import CompilerDOM from "@vue/compiler-dom";
import { toString } from "muggle-string";
import { codeFeatures } from "../codeFeatures";
import { newLine } from "../utils";
import { generateInterpolation } from "./interpolation";
import { generateTemplateChild } from "./templateChild";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateVIf(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.IfNode,
): Generator<Code> {
  const originalConditionsLength = ctx.conditions.length;

  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i];

    if (i === 0) {
      yield `if `;
    }
    else if (branch.condition) {
      yield `else if `;
    }
    else {
      yield `else `;
    }

    let isConditionAdded = false;

    if (branch.condition?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
      const codes = [...generateInterpolation(
        options,
        ctx,
        options.template,
        branch.condition.content,
        branch.condition.loc.start.offset,
        codeFeatures.verification,
        `(`,
        `)`,
      )];
      yield* codes;
      ctx.conditions.push(toString(codes));
      isConditionAdded = true;
      yield ` `;
    }

    yield `{${newLine}`;
    for (const child of branch.children) {
      yield* generateTemplateChild(options, ctx, child, i !== 0, true);
    }
    yield `}${newLine}`;

    if (isConditionAdded) {
      ctx.conditions[ctx.conditions.length - 1] = `!${ctx.conditions.at(-1)}`;
    }
  }

  ctx.conditions.length = originalConditionsLength;
}
