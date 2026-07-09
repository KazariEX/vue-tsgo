import { spawn } from "node:child_process";
import { hyphenate } from "@vue/shared";
import { ResolverFactory } from "oxc-resolver";
import { join } from "pathe";
import type CompilerDOM from "@vue/compiler-dom";
import type { Mapping } from "@vue/language-core";
import type { Segment } from "muggle-string";
import type { IRTemplate } from "./parse/ir";
import type { CodeInformation } from "./types";

export function runTsgo(...args: string[]) {
  const resolver = ResolverFactory.default();
  const resolvedTsgo = resolver.sync(process.cwd(), "typescript/package.json");

  if (resolvedTsgo?.path === void 0) {
    console.error(`[Vue] Failed to resolve the path of tsgo. Please ensure the typescript@7 is installed.`);
    process.exit(1);
  }
  const tsgo = join(resolvedTsgo.path, "../bin/tsc");

  return spawn(process.execPath, [tsgo, ...args]);
}

export { hyphenate as hyphenateTag };

export function hyphenateAttr(str: string) {
  let hyphenated = hyphenate(str);
  if (str && str[0] !== str[0].toLowerCase()) {
    hyphenated = "-" + hyphenated;
  }
  return hyphenated;
}

export function getAttributeValueOffset(node: CompilerDOM.TextNode) {
  let offset = node.loc.start.offset;
  if (node.loc.source.startsWith("\"") || node.loc.source.startsWith("'")) {
    offset++;
  }
  return offset;
}

export function getElementTagOffsets(node: CompilerDOM.ElementNode, template: IRTemplate) {
  const offsets = [
    template.ast.source.indexOf(node.tag, node.loc.start.offset),
  ];
  if (!node.isSelfClosing && template.lang === "html") {
    const endTagOffset = node.loc.start.offset + node.loc.source.lastIndexOf(node.tag);
    if (endTagOffset > offsets[0]) {
      offsets.push(endTagOffset);
    }
  }
  return offsets as [number] | [number, number];
}

export function toMappings<T>(codes: Segment<T>[]) {
  const mappings: Mapping<T>[] = [];

  let length = 0;
  for (const code of codes) {
    if (typeof code === "string") {
      length += code.length;
      continue;
    }
    else {
      mappings.push({
        sourceOffsets: [code[2]],
        generatedOffsets: [length],
        lengths: [code[0].length],
        data: code[3]!,
      });
      length += code[0].length;
    }
  }

  return mappings;
}

export function isVerificationEnabled(data: CodeInformation, code: number) {
  return (
    data.verification === true ||
    typeof data.verification === "object" &&
    data.verification.shouldReport(code) === true
  );
}
