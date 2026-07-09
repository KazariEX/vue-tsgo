import CompilerDOM from "@vue/compiler-dom";
import { parseSync } from "oxc-parser";
import { codeFeatures } from "../codeFeatures";
import { helpers } from "../names";
import { collectBindingIdentifiers } from "../ranges/binding";
import { newLine } from "../utils";
import { generateInterpolation } from "./interpolation";
import { generateTemplateChild } from "./templateChild";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateVFor(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ForNode,
): Generator<Code> {
  const { source } = node.parseResult;
  const scope = ctx.scope();

  yield `for (const [`;
  const { value, key, index } = node.parseResult;
  if (value || key || index) {
    const start = (value ?? key ?? index)!.loc.start.offset;
    const end = (index ?? key ?? value)!.loc.end.offset;
    const text = node.loc.source.slice(start - node.loc.start.offset, end - node.loc.start.offset);

    const { program: ast } = parseSync("dummy.ts", `const [${text}]`);
    ctx.declare(...collectBindingIdentifiers(ast).map((i) => i.name));
    yield [text, "template", start, codeFeatures.verification];
  }
  yield `] of `;
  if (source.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
    yield `${helpers.vFor}(`;
    yield* generateInterpolation(
      options,
      ctx,
      options.template,
      source.content,
      source.loc.start.offset,
      codeFeatures.verification,
      `(`,
      `)`,
    );
    yield `!)`;
  }
  else {
    yield `{} as any`;
  }
  yield `) {${newLine}`;

  const { inVFor } = ctx;
  ctx.inVFor = true;
  for (const child of node.children) {
    yield* generateTemplateChild(options, ctx, child, false, true);
  }
  ctx.inVFor = inVFor;

  yield `}${newLine}`;
  scope.end();
}
