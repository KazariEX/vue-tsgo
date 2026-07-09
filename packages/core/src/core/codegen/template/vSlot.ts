import CompilerDOM from "@vue/compiler-dom";
import { replaceSourceRange } from "muggle-string";
import { parseSync, type TSTypeAnnotation } from "oxc-parser";
import { codeFeatures } from "../codeFeatures";
import { helpers } from "../names";
import { collectBindingIdentifiers } from "../ranges/binding";
import { endOfLine, newLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { generateInterpolation } from "./interpolation";
import { generateObjectProperty } from "./objectProperty";
import { generateTemplateChild } from "./templateChild";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateVSlot(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
  slotDir: CompilerDOM.DirectiveNode | undefined,
  ctxVar: string,
): Generator<Code> {
  const slotVar = ctx.getInternalVariable();

  if (slotDir) {
    yield `{${newLine}`;
    yield `const { `;
    if (slotDir.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION && slotDir.arg.content) {
      yield* generateObjectProperty(
        options,
        ctx,
        slotDir.arg.loc.source,
        slotDir.arg.loc.start.offset,
        codeFeatures.verification,
        false,
        true,
      );
    }
    else {
      yield* generateBoundary(
        "template",
        slotDir.loc.start.offset,
        slotDir.loc.start.offset + (slotDir.rawName?.length ?? 0),
        codeFeatures.verification,
        `default`,
      );
    }
  }
  else {
    yield `const { default`;
  }
  yield `: ${slotVar} } = ${ctxVar}.slots!${endOfLine}`;

  const scope = ctx.scope();
  if (slotDir?.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
    yield* generateSlotParameters(options, ctx, slotDir.exp, slotVar);
  }
  for (const child of node.children) {
    yield* generateTemplateChild(options, ctx, child);
  }
  scope.end();

  if (slotDir) {
    yield `}${newLine}`;
  }
}

function* generateSlotParameters(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  exp: CompilerDOM.SimpleExpressionNode,
  slotVar: string,
): Generator<Code> {
  const text = `(${exp.content}) => {}`;
  const { program: ast } = parseSync("dummy.ts", text);

  const statement = ast.body[0];
  if (
    !statement ||
    statement.type !== "ExpressionStatement" ||
    statement.expression.type !== "ArrowFunctionExpression"
  ) {
    return;
  }

  const { expression } = statement;
  const startOffset = exp.loc.start.offset - 1;
  const types: (Code | null)[] = [];
  const interpolation = [...generateInterpolation(
    options,
    ctx,
    options.template,
    text,
    startOffset,
    codeFeatures.verification,
  )];

  replaceSourceRange(interpolation, "template", startOffset, startOffset + `(`.length);
  replaceSourceRange(
    interpolation,
    "template",
    startOffset + text.length - `) => {}`.length,
    startOffset + text.length,
  );

  for (const parameter of expression.params) {
    if (parameter.type === "TSParameterProperty") {
      continue;
    }

    let nameEnd: number;
    let typeEnd: number | undefined;

    if (parameter.type === "RestElement") {
      nameEnd = parameter.argument.end;
      typeEnd = parameter.typeAnnotation?.end;
    }
    else {
      const type = parameter.typeAnnotation as TSTypeAnnotation | undefined;
      nameEnd = type?.start ?? parameter.end;
      typeEnd = type?.end;
    }

    if (typeEnd !== void 0) {
      types.push([
        text.slice(nameEnd, typeEnd),
        "template",
        startOffset + nameEnd,
        codeFeatures.verification,
      ]);
      replaceSourceRange(interpolation, "template", startOffset + nameEnd, startOffset + nameEnd, `/* `);
      replaceSourceRange(interpolation, "template", startOffset + typeEnd, startOffset + typeEnd, ` */`);
    }
    else {
      types.push(null);
    }
  }

  yield `const [`;
  yield* interpolation;
  yield `] = ${helpers.vSlot}(${slotVar}!`;

  if (types.some((t) => t)) {
    yield `, `;
    const boundary = yield* generateBoundary(
      "template",
      exp.loc.start.offset,
      exp.loc.end.offset,
      codeFeatures.verification,
    );
    yield `(`;
    yield* types.flatMap((type) => (type ? [`_`, type, `, `] : `_, `));
    yield `) => {}`;
    yield boundary.end();
  }
  yield `)${endOfLine}`;

  ctx.declare(...collectBindingIdentifiers(ast).map((i) => i.name));
}
