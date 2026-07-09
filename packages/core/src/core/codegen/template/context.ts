import CompilerDOM from "@vue/compiler-dom";
import { isVerificationEnabled } from "../../shared";
import { endOfLine, newLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import type { Code, CodeInformation } from "../../types";

export type TemplateCodegenContext = ReturnType<typeof createTemplateCodegenContext>;

const commentDirectiveRE = /^<!--\s*@vue-(?<name>[-\w]+)\b(?<content>[\s\S]*)-->$/;

export function createTemplateCodegenContext() {
  let variableId = 0;

  const scopes: Set<string>[] = [];
  const components: (() => string)[] = [];
  const conditions: string[] = [];
  const accessedVars = new Set<string>();
  const dollarVars = new Set<string>();
  const hoistVars = new Map<string, string>();
  const singleRootElTypes = new Set<string>();
  const singleRootNodes = new Set<CompilerDOM.ElementNode | null>();
  const inheritedAttrVars = new Set<string>();
  const slots: {
    name: string;
    offset?: number;
    propsVar: string;
  }[] = [];
  const dynamicSlots: {
    expVar: string;
    propsVar: string;
  }[] = [];
  const templateRefs = new Map<string, {
    typeExp: string;
    offset: number;
  }[]>();

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

  return {
    generatedTypes: new Set<string>(),
    get currentInfo() {
      return stack.at(-1)!;
    },
    resolveCodeFeatures,
    inVFor: false,
    scopes,
    components,
    conditions,
    accessedVars,
    dollarVars,
    hoistVars,
    singleRootElTypes,
    singleRootNodes,
    inheritedAttrVars,
    slots,
    dynamicSlots,
    templateRefs,
    declare(...names: string[]) {
      const scope = scopes.at(-1)!;
      for (const name of names) {
        scope.add(name);
      }
    },
    scope() {
      const scope = new Set<string>();
      scopes.push(scope);
      return {
        end: () => scopes.pop(),
      };
    },
    accessVariable(name: string) {
      accessedVars.add(name);
    },
    addTemplateRef(name: string, typeExp: string, offset: number) {
      let refs = templateRefs.get(name);
      if (!refs) {
        templateRefs.set(name, refs = []);
      }
      refs.push({ typeExp, offset });
    },
    getInternalVariable() {
      return `__VLS_${variableId++}`;
    },
    getHoistVariable(originalVar: string) {
      let name = hoistVars.get(originalVar);
      if (name === void 0) {
        hoistVars.set(originalVar, name = `__VLS_${variableId++}`);
      }
      return name;
    },
    * generateHoistVariables() {
      if (hoistVars.size) {
        yield `// @ts-ignore${newLine}`;
        yield `var `;
        for (const [originalVar, hoistVar] of hoistVars) {
          yield `${hoistVar} = ${originalVar}, `;
        }
        yield endOfLine;
      }
    },
    * generateConditionGuards() {
      for (const condition of conditions) {
        yield `if (!${condition}) throw 0${endOfLine}`;
      }
    },
    enter(node: CompilerDOM.RootNode | CompilerDOM.TemplateChildNode | CompilerDOM.SimpleExpressionNode) {
      if (node.type === CompilerDOM.NodeTypes.COMMENT) {
        commentBuffer.push(node);
        return false;
      }

      const data: typeof stack[number] = {};
      const comments = [...commentBuffer];
      commentBuffer.length = 0;

      for (const comment of comments) {
        const match = comment.loc.source.match(commentDirectiveRE);
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
    },
    * exit(): Generator<Code> {
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
    },
  };

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
}
