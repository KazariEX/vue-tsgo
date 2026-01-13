import { newLine } from "./index";
import type { Code } from "../../types";

export function* generateSpreadMerge(...codes: Code[]): Generator<Code> {
    if (codes.length <= 1) {
        yield* codes;
    }
    else {
        yield `{${newLine}`;
        for (const code of codes) {
            yield `...`;
            yield code;
            yield `,${newLine}`;
        }
        yield `}`;
    }
}
