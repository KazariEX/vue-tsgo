import CompilerDOM from "@vue/compiler-dom";
import { camelize } from "@vue/shared";
import { matchesGlob } from "pathe";
import type { VueCompilerOptions } from "@vue/language-core";
import { getAttributeValueOffset, hyphenateAttr, hyphenateTag } from "../../shared";
import { codeFeatures } from "../codeFeatures";
import { helpers, names } from "../names";
import { identifierRE, newLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { generateCamelized } from "../utils/camelized";
import { generateUnicode } from "../utils/unicode";
import { generateModifiers } from "./elementDirectives";
import { generateEventArg, generateEventExpression } from "./elementEvents";
import { generateInterpolation } from "./interpolation";
import { generateObjectProperty } from "./objectProperty";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export interface FailedPropExpression {
  node: CompilerDOM.SimpleExpressionNode;
  prefix: string;
  suffix: string;
}

export function* generateElementProps(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
  props: CompilerDOM.ElementNode["props"],
  checkUnknownProps: boolean,
  failedPropExps?: FailedPropExpression[],
): Generator<Code> {
  const isComponent = node.tagType === CompilerDOM.ElementTypes.COMPONENT;

  for (const prop of props) {
    if (prop.type !== CompilerDOM.NodeTypes.DIRECTIVE || prop.name !== "on") {
      continue;
    }

    if (
      prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION &&
      !prop.arg.loc.source.startsWith("[") &&
      !prop.arg.loc.source.endsWith("]")
    ) {
      if (!isComponent) {
        yield `...{`;
        yield* generateEventArg(options, prop.arg.loc.source, prop.arg.loc.start.offset);
        yield `: `;
        yield* generateEventExpression(options, ctx, prop);
        yield `},`;
      }
      else {
        yield `...{ "${camelize(`on-${prop.arg.loc.source}`)}": {} as any },`;
      }
      yield newLine;
    }
    else if (
      prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION &&
      prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION &&
      prop.arg.loc.source.startsWith("[") &&
      prop.arg.loc.source.endsWith("]")
    ) {
      failedPropExps?.push({ node: prop.arg, prefix: "(", suffix: ")" });
      failedPropExps?.push({ node: prop.exp, prefix: "() => {", suffix: "}" });
    }
    else if (!prop.arg && prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
      failedPropExps?.push({ node: prop.exp, prefix: "(", suffix: ")" });
    }
  }

  for (const prop of props) {
    if (
      prop.type === CompilerDOM.NodeTypes.DIRECTIVE && (
        prop.name === "model" || (
          prop.name === "bind" && prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
        )
      ) && (!prop.exp || prop.exp.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION)
    ) {
      let propName: string | undefined;

      if (prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
        propName = prop.arg.constType === CompilerDOM.ConstantTypes.CAN_STRINGIFY
          ? prop.arg.content
          : prop.arg.loc.source;
      }
      else {
        propName = getModelPropName(node, options.vueCompilerOptions);
      }

      if (
        propName === void 0 ||
        options.vueCompilerOptions.dataAttributes.some((pattern) => matchesGlob(propName!, pattern))
      ) {
        if (prop.exp && prop.exp.constType !== CompilerDOM.ConstantTypes.CAN_STRINGIFY) {
          failedPropExps?.push({ node: prop.exp, prefix: "(", suffix: ")" });
        }
        continue;
      }

      if (
        prop.name === "bind" &&
        prop.modifiers.some((m) => m.content === "prop" || m.content === "attr")
      ) {
        propName = propName.slice(1);
      }

      const shouldSpread = propName === "style" || propName === "class";
      const shouldCamelize = getShouldCamelize(options, node, prop, propName);
      const features = getPropsCodeFeatures(checkUnknownProps);

      if (shouldSpread) {
        yield `...{ `;
      }
      const boundary = yield* generateBoundary(
        "template",
        prop.loc.start.offset,
        prop.loc.end.offset,
        codeFeatures.verification,
      );
      if (prop.arg) {
        yield* generateObjectProperty(
          options,
          ctx,
          propName,
          prop.arg.loc.start.offset,
          features,
          shouldCamelize,
        );
      }
      else {
        const boundary = yield* generateBoundary(
          "template",
          prop.loc.start.offset,
          prop.loc.start.offset + "v-model".length,
          codeFeatures.verification,
        );
        yield propName;
        yield boundary.end();
      }
      yield `: `;
      const argLoc = prop.arg?.loc ?? prop.loc;
      const boundary2 = yield* generateBoundary(
        "template",
        argLoc.start.offset,
        argLoc.end.offset,
        codeFeatures.verification,
      );
      yield* generatePropExp(options, ctx, prop, prop.exp);
      yield boundary2.end();
      yield boundary.end();
      if (shouldSpread) {
        yield ` }`;
      }
      yield `,${newLine}`;

      if (isComponent && prop.name === "model" && prop.modifiers.length) {
        const propertyName = prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
          ? !prop.arg.isStatic
            ? `[${helpers.tryAsConstant}(\`\${${prop.arg.content}}Modifiers\`)]`
            : camelize(propName) + "Modifiers"
          : `modelModifiers`;
        yield* generateModifiers(options, ctx, prop, propertyName);
        yield newLine;
      }
    }
    else if (prop.type === CompilerDOM.NodeTypes.ATTRIBUTE) {
      if (options.vueCompilerOptions.dataAttributes.some((pattern) => matchesGlob(prop.name, pattern))) {
        continue;
      }

      const shouldSpread = prop.name === "style" || prop.name === "class";
      const shouldCamelize = getShouldCamelize(options, node, prop, prop.name);
      const features = getPropsCodeFeatures(checkUnknownProps);

      if (shouldSpread) {
        yield `...{ `;
      }
      const boundary = yield* generateBoundary(
        "template",
        prop.loc.start.offset,
        prop.loc.end.offset,
        codeFeatures.verification,
      );
      yield* generateObjectProperty(
        options,
        ctx,
        prop.name,
        prop.loc.start.offset,
        features,
        shouldCamelize,
      );
      yield `: `;
      if (prop.name === "style") {
        yield `{}`;
      }
      else if (prop.value) {
        yield* generateAttrValue(prop.value, codeFeatures.verification);
      }
      else {
        yield `true`;
      }
      yield boundary.end();
      if (shouldSpread) {
        yield ` }`;
      }
      yield `,${newLine}`;
    }
    else if (
      prop.name === "bind" && !prop.arg &&
      prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
    ) {
      if (prop.exp.loc.source === "$attrs") {
        failedPropExps?.push({ node: prop.exp, prefix: "(", suffix: ")" });
      }
      else {
        const boundary = yield* generateBoundary(
          "template",
          prop.loc.start.offset,
          prop.exp.loc.end.offset,
          codeFeatures.verification,
        );
        yield `...`;
        yield* generatePropExp(options, ctx, prop, prop.exp);
        yield boundary.end();
        yield `,${newLine}`;
      }
    }
  }
}

export function* generatePropExp(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  prop: CompilerDOM.DirectiveNode,
  exp: CompilerDOM.SimpleExpressionNode | undefined,
): Generator<Code> {
  if (!exp) {
    yield `{}`;
  }
  else if (prop.arg?.loc.start.offset !== prop.exp?.loc.start.offset) {
    yield* generateInterpolation(
      options,
      ctx,
      options.template,
      exp.loc.source,
      exp.loc.start.offset,
      codeFeatures.verification,
      `(`,
      `)`,
    );
  }
  else {
    const propVariableName = camelize(exp.loc.source);

    if (identifierRE.test(propVariableName)) {
      const codes = generateCamelized(
        exp.loc.source,
        "template",
        exp.loc.start.offset,
        codeFeatures.verification,
      );

      if (ctx.scopes.some((scope) => scope.has(propVariableName))) {
        yield* codes;
      }
      else if (options.setupRefs.has(propVariableName)) {
        yield* codes;
        yield `.value`;
      }
      else {
        ctx.accessVariable(propVariableName);
        yield names.ctx;
        yield `.`;
        yield* codes;
      }
    }
  }
}

function* generateAttrValue(node: CompilerDOM.TextNode, features: CodeInformation): Generator<Code> {
  const quote = node.loc.source.startsWith("'") ? "'" : "\"";
  const offset = getAttributeValueOffset(node);
  yield quote;
  yield* generateUnicode(node.content, offset, features);
  yield quote;
}

function getShouldCamelize(
  options: TemplateCodegenOptions,
  node: CompilerDOM.ElementNode,
  prop: CompilerDOM.AttributeNode | CompilerDOM.DirectiveNode,
  propName: string,
) {
  return (
    node.tagType === CompilerDOM.ElementTypes.COMPONENT ||
    node.tagType === CompilerDOM.ElementTypes.SLOT
  ) && (
    prop.type !== CompilerDOM.NodeTypes.DIRECTIVE ||
    prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic
  )
    && hyphenateAttr(propName) === propName
    && !options.vueCompilerOptions.htmlAttributes.some((pattern) => matchesGlob(propName, pattern));
}

function getPropsCodeFeatures(checkUnknownProps: boolean) {
  return checkUnknownProps
    ? codeFeatures.verification
    : codeFeatures.doNotReportTs2353AndTs2561;
}

function getModelPropName(node: CompilerDOM.ElementNode, vueCompilerOptions: VueCompilerOptions) {
  for (const modelName in vueCompilerOptions.experimentalModelPropName) {
    const tags = vueCompilerOptions.experimentalModelPropName[modelName];
    const val = tags[node.tag] ?? tags[hyphenateTag(node.tag)];
    if (typeof val === "object") {
      for (const attrs of Array.isArray(val) ? val : [val]) {
        let failed = false;
        for (const attr in attrs) {
          const attrNode = node.props.find((prop): prop is CompilerDOM.AttributeNode => (
            prop.type === CompilerDOM.NodeTypes.ATTRIBUTE && prop.name === attr
          ));
          if (!attrNode || attrNode.value?.content !== attrs[attr]) {
            failed = true;
            break;
          }
        }
        if (!failed) {
          return modelName || void 0;
        }
      }
    }
  }

  for (const modelName in vueCompilerOptions.experimentalModelPropName) {
    const tags = vueCompilerOptions.experimentalModelPropName[modelName];
    const attrs = tags[node.tag] ?? tags[hyphenateTag(node.tag)];
    if (attrs === true) {
      return modelName || void 0;
    }
  }

  return "modelValue";
}
