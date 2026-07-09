import { generateBoundary } from "./boundary";
import type { Code, CodeInformation } from "../../types";

export function* generateUnicode(code: string, offset: number, info: CodeInformation): Generator<Code> {
  if (code.includes("\\") || code.includes("\n")) {
    yield* generateBoundary(
      "template",
      offset,
      offset + code.length,
      info,
      toUnicode(code),
    );
  }
  else {
    yield [code, "template", offset, info];
  }
}

function toUnicode(str: string) {
  return str.split("").map((value) => {
    const temp = value.charCodeAt(0).toString(16).padStart(4, "0");
    if (temp.length > 2) {
      return "\\u" + temp;
    }
    return value;
  }).join("");
}
