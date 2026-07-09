import type { Code, CodeInformation } from "../../types";

export function generateBoundary(
  source: string,
  start: number,
  end: number,
  features: CodeInformation,
): Generator<Code, {
  token: symbol;
  end: () => Code;
}>;

export function generateBoundary(
  source: string,
  start: number,
  end: number,
  features: CodeInformation,
  ...codes: Code[]
): Generator<Code, void>;

export function* generateBoundary(
  source: string,
  start: number,
  end: number,
  features: CodeInformation,
  ...codes: Code[]
): Generator<Code> {
  const token = Symbol(source);
  yield ["", source, start, { ...features, __combineToken: token }];

  if (codes.length) {
    yield* codes;
    yield ["", source, end, { __combineToken: token }];
  }
  else {
    return {
      token,
      end: () => ["", source, end, { __combineToken: token }],
    };
  }
}
