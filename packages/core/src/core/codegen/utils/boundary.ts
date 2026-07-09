import type { Code, CodeInformation } from "../../types";

export class Boundary {
  private constructor(
    private source: string,
    private end2: number,
    public features: CodeInformation,
  ) {}

  static * start(
    source: string,
    start: number,
    end: number,
    features: CodeInformation,
  ): Generator<Code, Boundary> {
    features = { ...features, __combineToken: Symbol() };
    yield [``, source, start, features];
    return new Boundary(source, end, features);
  }

  end(): Code {
    return [``, this.source, this.end2, this.features];
  }
}

export function* generateBoundary(
  source: string,
  start: number,
  end: number,
  features: CodeInformation,
  ...codes: [Code, ...Code[]]
): Generator<Code> {
  features = { ...features, __combineToken: Symbol() };
  yield ["", source, start, features];
  yield* codes;
  yield ["", source, end, features];
}
