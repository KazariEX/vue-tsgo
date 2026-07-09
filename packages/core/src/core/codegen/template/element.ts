import CompilerDOM from "@vue/compiler-dom";
import { camelize, capitalize } from "@vue/shared";
import { toString } from "muggle-string";
import { getAttributeValueOffset, getElementTagOffsets, hyphenateTag } from "../../shared";
import { codeFeatures } from "../codeFeatures";
import { helpers, names } from "../names";
import { endOfLine, identifierRE, newLine } from "../utils";
import { generateBoundary } from "../utils/boundary";
import { generateCamelized } from "../utils/camelized";
import { generateStringLiteralKey } from "../utils/stringLiteralKey";
import { generateElementDirectives } from "./elementDirectives";
import { generateElementEvents } from "./elementEvents";
import { type FailedPropExpression, generateElementProps } from "./elementProps";
import { generateInterpolation } from "./interpolation";
import { generatePropertyAccess } from "./propertyAccess";
import { generateTemplateChild } from "./templateChild";
import { generateVSlot } from "./vSlot";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateComponent(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
): Generator<Code> {
  const componentVar = ctx.getInternalVariable();
  const functionalVar = ctx.getInternalVariable();
  const vnodeVar = ctx.getInternalVariable();
  const ctxVar = ctx.getInternalVariable();
  const propsVar = ctx.getInternalVariable();

  let isCtxVarUsed = false;
  let isPropsVarUsed = false;
  const getCtxVar = () => (isCtxVarUsed = true, ctxVar);
  const getPropsVar = () => (isPropsVarUsed = true, propsVar);
  ctx.components.push(getCtxVar);

  let { tag, props } = node;
  let [startTagOffset, endTagOffset] = getElementTagOffsets(node, options.template);
  let isExpression = false;

  if (tag.includes(".")) {
    isExpression = true;
  }
  else if (tag === "component") {
    for (const prop of props) {
      if (
        prop.type === CompilerDOM.NodeTypes.DIRECTIVE &&
        prop.name === "bind" &&
        prop.arg?.loc.source === "is" &&
        prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
      ) {
        tag = prop.exp.content;
        props = props.filter((p) => p !== prop);
        startTagOffset = prop.exp.loc.start.offset;
        endTagOffset = void 0;
        isExpression = true;
        break;
      }
    }
  }

  if (isExpression) {
    yield `const ${componentVar} = `;
    yield* generateInterpolation(
      options,
      ctx,
      options.template,
      tag,
      startTagOffset,
      codeFeatures.verification,
      `(`,
      `)`,
    );
    if (endTagOffset !== void 0) {
      yield ` || `;
      yield* generateInterpolation(
        options,
        ctx,
        options.template,
        tag,
        endTagOffset,
        codeFeatures.verification,
        `(`,
        `)`,
      );
    }
    yield endOfLine;
  }
  else {
    const originalNames = new Set([capitalize(camelize(tag)), camelize(tag), tag]);
    const setupConst = [...originalNames].find((name) => options.setupConsts.has(name));
    if (setupConst !== void 0) {
      yield `const ${componentVar} = `;
      yield* generateCamelized(
        setupConst[0] + tag.slice(1),
        "template",
        startTagOffset,
        codeFeatures.verification,
      );
      if (endTagOffset !== void 0) {
        yield ` || `;
        yield* generateCamelized(
          setupConst[0] + tag.slice(1),
          "template",
          endTagOffset,
          codeFeatures.verification,
        );
      }
      yield endOfLine;
    }
    else {
      yield `let ${componentVar}!: ${helpers.WithComponent}<"${tag}", ${names.LocalComponents}, ${names.GlobalComponents}`;
      yield originalNames.has(options.componentName)
        ? `, typeof ${names.export}`
        : `, void`;
      for (const name of originalNames) {
        yield `, "${name}"`;
      }
      yield `>[`;
      yield* generateStringLiteralKey(
        tag,
        startTagOffset,
        options.vueCompilerOptions.checkUnknownComponents
          ? codeFeatures.verification
          : codeFeatures.doNotReportTs2339AndTs2551,
      );
      yield `]${endOfLine}`;
    }
  }

  const failedPropExps: FailedPropExpression[] = [];
  const propCodes = [...generateElementProps(
    options,
    ctx,
    node,
    props,
    options.vueCompilerOptions.checkUnknownProps,
    failedPropExps,
  )];
  const propsStr = toString(propCodes);

  yield `// @ts-ignore${newLine}`;
  yield `const ${functionalVar} = ${
    options.vueCompilerOptions.checkUnknownProps
      ? helpers.asFunctionalComponent0
      : helpers.asFunctionalComponent1
  }(${componentVar}, new ${componentVar}({${newLine}`;
  yield propsStr;
  yield `}))${endOfLine}`;

  yield `const `;
  yield* generateBoundary(
    "component",
    node.loc.start.offset,
    node.loc.end.offset,
    codeFeatures.doNotReportTs6133,
    vnodeVar,
  );
  yield ` = ${functionalVar}`;

  const commentInfo = ctx.getCommentInfo();
  if (commentInfo.generic) {
    const { content, offset } = commentInfo.generic;
    const boundary = yield* generateBoundary(
      "template",
      offset,
      offset + content.length,
      codeFeatures.verification,
    );
    yield `<`;
    yield [content, "template", offset, { __combineToken: boundary.token }];
    yield `>`;
    yield boundary.end();
  }

  const shouldInheritAttrs = hasVBindAttrs(options, ctx, node);

  yield `(`;
  const boundary = yield* generateBoundary(
    "component",
    startTagOffset,
    startTagOffset + tag.length,
    shouldInheritAttrs && options.vueCompilerOptions.checkRequiredFallthroughAttributes
      ? {}
      : codeFeatures.verification,
  );
  yield `{${newLine}`;
  yield* propCodes;
  yield `}`;
  yield boundary.end();
  yield `, ...${helpers.functionalComponentArgsRest}(${functionalVar}))${endOfLine}`;

  yield* generateFailedExpressions(options, ctx, failedPropExps);
  yield* generateElementEvents(
    options,
    ctx,
    node,
    componentVar,
    getCtxVar,
    getPropsVar,
  );
  yield* generateElementDirectives(options, ctx, node);

  const templateRef = getTemplateRef(options, ctx, node);
  const isSingleRoot = ctx.singleRootNodes.has(node) &&
    !options.vueCompilerOptions.fallthroughComponentNames.includes(hyphenateTag(tag));

  if (templateRef || isSingleRoot) {
    const instanceVar = ctx.getInternalVariable();
    yield `var ${instanceVar}!: Parameters<NonNullable<typeof ${getCtxVar()}["expose"]>>[0]`;
    yield endOfLine;

    if (templateRef) {
      let typeExp = `typeof ${ctx.getHoistVariable(instanceVar)} | null`;
      if (ctx.inVFor) {
        typeExp = `(${typeExp})[]`;
      }
      ctx.addTemplateRef(templateRef.name, typeExp, templateRef.offset);
    }
    if (isSingleRoot) {
      ctx.singleRootElTypes.add(`NonNullable<typeof ${instanceVar}>["$el"]`);
    }
  }

  if (shouldInheritAttrs) {
    if (options.vueCompilerOptions.checkRequiredFallthroughAttributes) {
      const restsVar = ctx.getInternalVariable();
      yield `var ${restsVar} = ${names.omit}(${getPropsVar()}, {\n${propsStr}})${endOfLine}`;
      ctx.inheritedAttrVars.add(restsVar);
    }
    else {
      ctx.inheritedAttrVars.add(getPropsVar());
    }
  }

  const slotDir = node.props.find(CompilerDOM.isVSlot);
  if (slotDir || node.children.length) {
    yield* generateVSlot(options, ctx, node, slotDir, getCtxVar());
  }

  if (isCtxVarUsed) {
    yield `var ${ctxVar}!: ${helpers.FunctionalComponentCtx}<typeof ${componentVar}, typeof ${vnodeVar}>${endOfLine}`;
  }
  if (isPropsVarUsed) {
    yield `var ${propsVar}!: ${helpers.FunctionalComponentProps}<typeof ${componentVar}, typeof ${vnodeVar}>${endOfLine}`;
  }
  ctx.components.pop();
}

export function* generateElement(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
): Generator<Code> {
  const [startTagOffset, endTagOffset] = getElementTagOffsets(node, options.template);
  const failedPropExps: FailedPropExpression[] = [];

  yield `${
    options.vueCompilerOptions.checkUnknownProps
      ? helpers.asFunctionalElement0
      : helpers.asFunctionalElement1
  }(${names.intrinsics}`;
  yield* generatePropertyAccess(
    options,
    ctx,
    node.tag,
    startTagOffset,
    codeFeatures.verification,
  );
  if (endTagOffset !== void 0) {
    yield `, ${names.intrinsics}`;
    yield* generatePropertyAccess(
      options,
      ctx,
      node.tag,
      endTagOffset,
      codeFeatures.verification,
    );
  }
  yield `)(`;
  const boundary = yield* generateBoundary(
    "element",
    startTagOffset,
    startTagOffset + node.tag.length,
    codeFeatures.verification,
  );
  yield `{${newLine}`;
  yield* generateElementProps(
    options,
    ctx,
    node,
    node.props,
    options.vueCompilerOptions.checkUnknownProps,
    failedPropExps,
  );
  yield `}`;
  yield boundary.end();
  yield `)${endOfLine}`;

  yield* generateFailedExpressions(options, ctx, failedPropExps);
  yield* generateElementDirectives(options, ctx, node);

  const templateRef = getTemplateRef(options, ctx, node);
  if (templateRef) {
    let typeExp = `${helpers.Elements}["${node.tag}"]`;
    if (ctx.inVFor) {
      typeExp += `[]`;
    }
    ctx.addTemplateRef(templateRef.name, typeExp, templateRef.offset);
  }

  if (ctx.singleRootNodes.has(node)) {
    ctx.singleRootElTypes.add(`${helpers.Elements}["${node.tag}"]`);
  }

  if (hasVBindAttrs(options, ctx, node)) {
    ctx.inheritedAttrVars.add(`${names.intrinsics}.${node.tag}`);
  }

  for (const child of node.children) {
    yield* generateTemplateChild(options, ctx, child);
  }
}

export function* generateFragment(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
): Generator<Code> {
  const [startTagOffset] = getElementTagOffsets(node, options.template);

  // special case for <template v-for="..." :key="..." />
  if (node.props.length) {
    yield `${
      options.vueCompilerOptions.checkUnknownProps
        ? helpers.asFunctionalElement0
        : helpers.asFunctionalElement1
    }(${names.intrinsics}.template)(`;
    const boundary = yield* generateBoundary(
      "template",
      startTagOffset,
      startTagOffset + node.tag.length,
      codeFeatures.verification,
    );
    yield `{${newLine}`;
    yield* generateElementProps(
      options,
      ctx,
      node,
      node.props,
      options.vueCompilerOptions.checkUnknownProps,
    );
    yield `}`;
    yield boundary.end();
    yield `)${endOfLine}`;
  }

  for (const child of node.children) {
    yield* generateTemplateChild(options, ctx, child);
  }
}

function* generateFailedExpressions(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  failedPropExps: FailedPropExpression[],
): Generator<Code> {
  for (const { node, prefix, suffix } of failedPropExps) {
    yield* generateInterpolation(
      options,
      ctx,
      options.template,
      node.loc.source,
      node.loc.start.offset,
      codeFeatures.verification,
      prefix,
      suffix,
    );
    yield endOfLine;
  }
}

function getTemplateRef(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
) {
  for (const prop of node.props) {
    if (
      prop.type === CompilerDOM.NodeTypes.ATTRIBUTE &&
      prop.name === "ref" &&
      prop.value
    ) {
      const name = prop.value.content;
      if (identifierRE.test(name) && !options.setupRefs.has(name)) {
        ctx.accessVariable(name);
      }
      return {
        name: prop.value.content,
        offset: getAttributeValueOffset(prop.value),
      };
    }
  }
}

function hasVBindAttrs(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
) {
  return options.vueCompilerOptions.fallthroughAttributes && (
    options.inheritAttrs && ctx.singleRootNodes.has(node) || node.props.some((prop) => (
      prop.type === CompilerDOM.NodeTypes.DIRECTIVE &&
      prop.name === "bind" &&
      prop.exp?.loc.source === "$attrs"
    ))
  );
}
