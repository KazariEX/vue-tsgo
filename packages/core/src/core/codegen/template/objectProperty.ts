import { camelize } from "@vue/shared";
import { helpers } from "../names";
import { identifierRE } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { generateCamelized } from "../utils/camelized";
import { generateStringLiteralKey } from "../utils/stringLiteralKey";
import { generateInterpolation } from "./interpolation";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateObjectProperty(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  code: string,
  offset: number,
  features: CodeInformation,
  shouldCamelize = false,
  shouldBeConstant = false,
): Generator<Code> {
  if (code.startsWith("[") && code.endsWith("]")) {
    if (shouldBeConstant) {
      yield* generateInterpolation(
        options,
        ctx,
        options.template,
        code.slice(1, -1),
        offset + 1,
        features,
        `[${helpers.tryAsConstant}(`,
        `)]`,
      );
    }
    else {
      yield* generateInterpolation(
        options,
        ctx,
        options.template,
        code,
        offset,
        features,
      );
    }
  }
  else if (shouldCamelize) {
    if (identifierRE.test(camelize(code))) {
      yield* generateCamelized(code, "template", offset, features);
    }
    else {
      const boundary = yield* generateBoundary("template", offset, offset + code.length, features);
      yield `"`;
      yield* generateCamelized(code, "template", offset, { __combineToken: boundary.token });
      yield `"`;
      yield boundary.end();
    }
  }
  else if (identifierRE.test(code)) {
    yield [code, "template", offset, features];
  }
  else {
    yield* generateStringLiteralKey(code, offset, features);
  }
}
