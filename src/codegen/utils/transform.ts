import { section } from "./index";
import type { IRScript, IRScriptSetup } from "../../parse/ir";
import type { Code, CodeInformation } from "../../types";

export function createCodeTransformer(
    block: IRScript | IRScriptSetup,
    start: number,
    end: number,
    features: CodeInformation,
) {
    const replacement: [number, number, ...Code[]][] = [];

    return {
        insert(offset: number, ...codes: Code[]) {
            replacement.push([offset, offset, ...codes]);
        },
        replace(start: number, end: number, ...codes: Code[]) {
            replacement.push([start, end, ...codes]);
        },
        * generate() {
            let offset = start;
            for (const [start, end, ...codes] of replacement.sort((a, b) => a[0] - b[0])) {
                yield section(block, offset, start, features);
                yield* codes;
                offset = end;
            }
            yield section(block, offset, end, features);
        },
    };
}
