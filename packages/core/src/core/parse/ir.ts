import CompilerDOM from "@vue/compiler-dom";
import { type Comment, type Diagnostic, parse, type Program, type SourceLang } from "yuku-parser";
import type { VueCompilerOptions } from "@vue/language-core";
import { getAttributeValueOffset } from "../shared";
import { createSFC } from "./sfc";
import { parseStyleBindings, parseStyleClassNames } from "./style/parse";
import { parseTemplate } from "./template/parse";

export interface IR {
  template?: IRTemplate;
  script?: IRScript;
  scriptSetup?: IRScriptSetup;
  styles: IRStyle[];
  comments: string[];
  customBlocks: IRCustomBlock[];
}

export interface IRBlock {
  name: string;
  lang: string;
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  attrs: Record<string, IRBlockAttr>;
  content: string;
}

export type IRBlockAttr = true | {
  text: string;
  offset: number;
  quotes: boolean;
};

export interface IRTemplate extends IRBlock {
  ast: CompilerDOM.RootNode;
  errors: CompilerDOM.CompilerError[];
  warnings: CompilerDOM.CompilerError[];
}

export interface IRScript extends IRBlock {
  ast: Program;
  comments: Comment[];
  errors: Diagnostic[];
}

export interface IRScriptSetup extends IRBlock {
  ast: Program;
  comments: Comment[];
  errors: Diagnostic[];
}

export interface IRStyle extends IRBlock {
  bindings: {
    text: string;
    offset: number;
  }[];
  classNames: {
    text: string;
    offset: number;
  }[];
}

export interface IRCustomBlock extends IRBlock {
  type: string;
}

export function createIR(sourcePath: string, sourceText: string, vueCompilerOptions: VueCompilerOptions) {
  const sfc = createSFC(sourcePath, sourceText, vueCompilerOptions);

  const ir: IR = {
    styles: [],
    comments: [],
    customBlocks: [],
  };

  for (const node of sfc.children) {
    if (node.type === CompilerDOM.NodeTypes.COMMENT) {
      ir.comments.push(node.content);
      continue;
    }
    else if (node.type !== CompilerDOM.NodeTypes.ELEMENT) {
      continue;
    }

    switch (node.tag) {
      case "template": {
        const block = createIRBlock(node, "html");
        const errors: CompilerDOM.CompilerError[] = [];
        const warnings: CompilerDOM.CompilerError[] = [];
        const options: CompilerDOM.CompilerOptions = {
          onError: (err) => errors.push(err),
          onWarn: (warn) => warnings.push(warn),
        };
        const ast = parseTemplate(block.content, options);

        ir.template = {
          ...block,
          name: "template",
          ast,
          errors,
          warnings,
        };
        break;
      }
      case "script": {
        const block = createIRBlock(node, "js");
        const result = parse(block.content, { lang: block.lang as SourceLang });

        if (block.attrs.setup || block.attrs.vapor) {
          ir.scriptSetup = {
            ...block,
            name: "scriptSetup",
            ast: result.program,
            comments: result.comments,
            errors: result.diagnostics,
          };
        }
        else {
          ir.script = {
            ...block,
            name: "script",
            ast: result.program,
            comments: result.comments,
            errors: result.diagnostics,
          };
        }
        break;
      }
      case "style": {
        const block = createIRBlock(node, "css");
        const bindings = [...parseStyleBindings(block.content)];
        const classNames = [...parseStyleClassNames(block.content)];

        ir.styles.push({
          ...block,
          name: `style_${ir.styles.length}`,
          bindings,
          classNames,
        });
        break;
      }
      default: {
        const block = createIRBlock(node, "txt");

        ir.customBlocks.push({
          ...block,
          name: `customBlock_${ir.customBlocks.length}`,
          type: node.tag,
        });
        break;
      }
    }
  }

  if (!ir.script && !ir.scriptSetup) {
    ir.scriptSetup = {
      name: "scriptSetup",
      lang: "ts",
      start: 0,
      end: 0,
      innerStart: 0,
      innerEnd: 0,
      attrs: {},
      content: "",
      ast: {
        type: "Program",
        body: [],
        sourceType: "module",
        hashbang: null,
        start: 0,
        end: 0,
      },
      comments: [],
      errors: [],
    };
  }

  return ir;
}

function createIRBlock(node: CompilerDOM.ElementNode, defaultLang: string): Omit<IRBlock, "name"> {
  const attrs: Record<string, IRBlockAttr> = {};
  for (const prop of node.props) {
    if (prop.type !== CompilerDOM.NodeTypes.ATTRIBUTE) {
      continue;
    }
    if (!prop.value) {
      attrs[prop.name] = true;
    }
    else {
      const offset = getAttributeValueOffset(prop.value);
      attrs[prop.name] = {
        text: prop.value.content,
        offset,
        quotes: offset > prop.value.loc.start.offset,
      };
    }
  }

  return {
    lang: typeof attrs.lang === "object" ? attrs.lang.text : defaultLang,
    start: node.loc.start.offset,
    end: node.loc.end.offset,
    innerStart: node.innerLoc!.start.offset,
    innerEnd: node.innerLoc!.end.offset,
    attrs,
    content: node.innerLoc!.source,
  };
}
