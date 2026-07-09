import { identifierRE } from "../utils";
import { generateStringLiteralKey } from "../utils/stringLiteralKey";
import { generateInterpolation } from "./interpolation";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generatePropertyAccess(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  code: string,
  offset: number,
  features: CodeInformation,
): Generator<Code> {
  if (code.startsWith("[") && code.endsWith("]")) {
    yield* generateInterpolation(
      options,
      ctx,
      options.template,
      code,
      offset,
      features,
    );
  }
  else if (identifierRE.test(code)) {
    yield `.`;
    yield [code, "template", offset, features];
  }
  else {
    yield `[`;
    yield* generateStringLiteralKey(code, offset, features);
    yield `]`;
  }
}
