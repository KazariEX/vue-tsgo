import type { IRScript, IRScriptSetup } from "../../parse/ir";
import type { Code, CodeInformation } from "../../types";

export const endOfLine = ";\n";
export const newLine = "\n";
export const identifierRE = /^[a-z_$][\w$]*$/i;

export function section(
    block: IRScript | IRScriptSetup,
    start: number,
    end: number,
    features: CodeInformation,
): Code {
    return [
        block.content.slice(start, end),
        block.name,
        start,
        features,
    ];
}
