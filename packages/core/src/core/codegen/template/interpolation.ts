import { isGloballyAllowed, makeMap } from "@vue/shared";
import { Analyzer } from "yuku-analyzer";
import { codeFeatures } from "../codeFeatures";
import { names } from "../names";
import { identifierRE } from "../utils";
import { Boundary } from "../utils/boundary";
import type { IRBlock } from "../../parse/ir";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

// https://github.com/vuejs/core/blob/fb0c3ca519f1fccf52049cd6b8db3a67a669afe9/packages/compiler-core/src/transforms/transformExpression.ts#L47
const isLiteralWhitelisted = /*@__PURE__*/ makeMap("true,false,null,this");

export function* generateInterpolation(
  options: Pick<TemplateCodegenOptions, "setupRefs">,
  ctx: TemplateCodegenContext,
  block: IRBlock,
  code: string,
  start: number,
  features: CodeInformation,
  prefix = "",
  suffix = "",
): Generator<Code> {
  if (prefix) {
    yield prefix;
  }

  let prevEnd = 0;
  for (
    const [name, offset, isShortHand] of forEachIdentifiers(
      ctx,
      code,
      prefix,
      suffix,
    )
  ) {
    if (isShortHand) {
      yield [
        code.slice(prevEnd, offset + name.length),
        block.name,
        start + prevEnd,
        features,
      ];
      yield `: `;
    }
    else if (prevEnd < offset) {
      yield [
        code.slice(prevEnd, offset),
        block.name,
        start + prevEnd,
        features,
      ];
    }

    if (options.setupRefs.has(name)) {
      yield [
        name,
        block.name,
        start + offset,
        features,
      ];
      yield `.value`;
    }
    else {
      const boundary = yield* Boundary.start(
        block.name,
        start + offset,
        start + offset + name.length,
        codeFeatures.verification,
      );
      if (ctx.dollarVars.has(name)) {
        yield names.dollars;
      }
      else {
        ctx.accessVariable(name);
        yield names.ctx;
      }
      yield `.`;
      yield [
        name,
        block.name,
        start + offset,
        features,
      ];
      yield boundary.end();
    }

    prevEnd = offset + name.length;
  }

  if (prevEnd < code.length) {
    yield [
      code.slice(prevEnd),
      block.name,
      start + prevEnd,
      features,
    ];
  }

  if (suffix) {
    yield suffix;
  }
}

function forEachIdentifiers(
  ctx: TemplateCodegenContext,
  code: string,
  prefix: string,
  suffix: string,
) {
  const identifiers: [string, number, boolean][] = [];

  if (identifierRE.test(code) && !shouldIdentifierSkipped(ctx, code)) {
    identifiers.push([code, 0, false]);
  }
  else {
    const analyzer = new Analyzer();
    const module = analyzer.addFile("dummy.ts", prefix + code + suffix);

    for (const { kind, node } of module.unresolvedReferences) {
      const parent = module.parentOf(node);
      if (
        kind === "type" && parent?.type !== "TSTypeQuery" ||
        shouldIdentifierSkipped(ctx, node.name)
      ) {
        continue;
      }
      identifiers.push([
        node.name,
        node.start - prefix.length,
        parent?.type === "Property" && parent.shorthand === true,
      ]);
    }
  }

  return identifiers;
}

export function shouldIdentifierSkipped(ctx: TemplateCodegenContext, text: string) {
  return ctx.scopes.some((scope) => scope.has(text)) ||
    isGloballyAllowed(text) ||
    isLiteralWhitelisted(text) ||
    text === "require" ||
    text.startsWith("__VLS_");
}
