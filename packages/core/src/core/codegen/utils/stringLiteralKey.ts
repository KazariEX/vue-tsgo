import { generateBoundary } from "./boundary";
import type { Code, CodeInformation } from "../../types";

export function* generateStringLiteralKey(
  code: string,
  offset?: number,
  features?: CodeInformation,
): Generator<Code> {
  if (offset === void 0 || !features) {
    yield `"${code}"`;
  }
  else {
    const boundary = yield* generateBoundary("template", offset, offset + code.length, features);
    yield `"`;
    yield [code, "template", offset, { __combineToken: boundary.token }];
    yield `"`;
    yield boundary.end();
  }
}
