import CompilerDOM from "@vue/compiler-dom";
import { isVerificationEnabled } from "../../shared";
import { endOfLine, newLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import type { Code, CodeInformation } from "../../types";

export type TemplateCodegenContext = ReturnType<typeof createTemplateCodegenContext>;

const directiveCommentRE = /^<!--\s*@vue-(?<name>[-\w]+)\b(?<content>[\s\S]*)-->$/;

export function createTemplateCodegenContext() {
  // directive comments ---------------------------------------------------------

  const stack: {
    ignoreError?: boolean;
    expectError?: {
      token: number;
      node: CompilerDOM.CommentNode;
    };
    generic?: {
      content: string;
      offset: number;
    };
  }[] = [];
  const commentBuffer: CompilerDOM.CommentNode[] = [];

  function getCommentInfo() {
    return stack.at(-1)!;
  }

  function enter(
    node:
      | CompilerDOM.RootNode
      | CompilerDOM.TemplateChildNode
      | CompilerDOM.SimpleExpressionNode,
  ) {
    if (node.type === CompilerDOM.NodeTypes.COMMENT) {
      commentBuffer.push(node);
      return false;
    }

    const data: typeof stack[number] = {};
    const comments = [...commentBuffer];
    commentBuffer.length = 0;

    for (const comment of comments) {
      const match = comment.loc.source.match(directiveCommentRE);
      if (!match) {
        continue;
      }

      const { name, content } = match.groups!;
      switch (name) {
        case "skip": {
          return false;
        }
        case "ignore": {
          data.ignoreError = true;
          break;
        }
        case "expect-error": {
          data.expectError = {
            token: 0,
            node: comment,
          };
          break;
        }
        case "generic": {
          const text = content.trim();
          if (text.startsWith("{") && text.endsWith("}")) {
            data.generic = {
              content: text.slice(1, -1),
              offset: comment.loc.start.offset + comment.loc.source.indexOf("{") + 1,
            };
          }
          break;
        }
      }
    }
    stack.push(data);
    return true;
  }

  function* exit(): Generator<Code> {
    const data = stack.pop()!;
    commentBuffer.length = 0;

    if (data.expectError) {
      yield* generateBoundary(
        "template",
        data.expectError.node.loc.start.offset,
        data.expectError.node.loc.end.offset,
        {
          verification: {
            shouldReport: () => data.expectError!.token === 0,
          },
        },
        `// @ts-expect-error`,
      );
      yield newLine;
      yield endOfLine;
    }
  }

  function resolveCodeFeatures(features: CodeInformation): CodeInformation {
    if (features.verification && stack.length) {
      const data = stack.at(-1)!;
      if (data.ignoreError) {
        return {
          ...features,
          verification: false,
        };
      }
      if (data.expectError) {
        return {
          ...features,
          verification: {
            shouldReport: (code) => {
              if (isVerificationEnabled(features, code)) {
                data.expectError!.token++;
              }
              return false;
            },
          },
        };
      }
    }
    return features;
  }

  // internal variables ---------------------------------------------------------

  let variableId = 0;

  function getInternalVariable() {
    return `__VLS_${variableId++}`;
  }

  // scopes ---------------------------------------------------------------------

  class Scope extends Set<string> {
    declare(...variables: string[]) {
      for (const name of variables) {
        this.add(name);
      }
    }

    end() {
      // eslint-disable-next-line ts/no-use-before-define
      scopes.pop();
    }
  }

  const scopes: Scope[] = [];

  function scope() {
    const scope = new Scope();
    scopes.push(scope);
    return scope;
  }

  // context accesses -----------------------------------------------------------

  const accessedVars = new Set<string>();

  function accessVariable(name: string) {
    accessedVars.add(name);
  }

  // conditions -----------------------------------------------------------------

  const conditions: string[] = [];

  function* generateConditionGuards() {
    for (const condition of conditions) {
      yield `if (!${condition}) throw 0${endOfLine}`;
    }
  }

  // hoist vars -----------------------------------------------------------------

  const hoistVars = new Map<string, string>();

  function getHoistVariable(originalVar: string) {
    let name = hoistVars.get(originalVar);
    if (name === void 0) {
      hoistVars.set(originalVar, name = `__VLS_${variableId++}`);
    }
    return name;
  }

  function* generateHoistVariables() {
    // trick to avoid TS 4081 (#5186)
    if (hoistVars.size) {
      yield `// @ts-ignore${newLine}`;
      yield `var `;
      for (const [originalVar, hoistVar] of hoistVars) {
        yield `${hoistVar} = ${originalVar}, `;
      }
      yield endOfLine;
    }
  }

  // template refs --------------------------------------------------------------

  const templateRefs = new Map<string, { typeExp: string; offset: number }[]>();

  function addTemplateRef(name: string, typeExp: string, offset: number) {
    let refs = templateRefs.get(name);
    if (!refs) {
      templateRefs.set(name, refs = []);
    }
    refs.push({ typeExp, offset });
  }

  // others ---------------------------------------------------------------------

  const components: (() => string)[] = [];
  const dollarVars = new Set<string>();
  const generatedTypes = new Set<string>();
  const inheritedAttrVars = new Set<string>();
  const singleRootElTypes = new Set<string>();
  const singleRootNodes = new Set<CompilerDOM.ElementNode | null>();
  const slots: {
    name: string;
    offset?: number;
    propsVar: string;
  }[] = [];
  const dynamicSlots: { expVar: string; propsVar: string }[] = [];

  return {
    getCommentInfo,
    enter,
    exit,
    resolveCodeFeatures,
    getInternalVariable,
    scopes,
    scope,
    accessedVars,
    accessVariable,
    conditions,
    generateConditionGuards,
    hoistVars,
    getHoistVariable,
    generateHoistVariables,
    templateRefs,
    addTemplateRef,
    components,
    dollarVars,
    generatedTypes,
    inheritedAttrVars,
    singleRootElTypes,
    singleRootNodes,
    slots,
    dynamicSlots,
    inVFor: false,
  };
}
