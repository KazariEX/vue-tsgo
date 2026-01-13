import type { Code, CodeInformation } from "../../types";

export function generateBoundary(
    source: string,
    start: number,
    features: CodeInformation,
): Generator<Code, {
    token: symbol;
    end: (offset: number) => Code;
}>;

export function generateBoundary(
    source: string,
    start: number,
    end: number,
    features: CodeInformation,
    ...codes: Code[]
): Generator<Code>;

export function* generateBoundary(
    source: string,
    start: number,
    ...args:
        | [features: CodeInformation]
        | [end: number, features: CodeInformation, ...Code[]]
): Generator<Code> {
    const token = Symbol(source);

    if (typeof args[0] === "object") {
        yield ["", source, start, { ...args[0], __combineToken: token }];
        return {
            token,
            end: (offset: number) => ["", source, offset, { __combineToken: token }],
        };
    }
    else {
        yield ["", source, start, { ...args[1], __combineToken: token }];
        yield* args.slice(2) as Code[];
        yield ["", source, args[0], { __combineToken: token }];
    }
}
