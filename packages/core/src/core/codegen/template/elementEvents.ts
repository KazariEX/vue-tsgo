import CompilerDOM from "@vue/compiler-dom";
import { camelize, capitalize } from "@vue/shared";
import { parseSync, type Program } from "oxc-parser";
import { codeFeatures } from "../codeFeatures";
import { helpers } from "../names";
import { getUnwrappedExpression } from "../ranges/utils";
import { endOfLine, identifierRE, newLine } from "../utils";
import { Boundary } from "../utils/boundary";
import { generateCamelized } from "../utils/camelized";
import { generateInterpolation } from "./interpolation";
import type { Code, CodeInformation } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateElementEvents(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.ElementNode,
  componentVar: string,
  getCtxVar: () => string,
  getPropsVar: () => string,
): Generator<Code> {
  const definitions: Record<string, {
    propPrefix: string;
    emitPrefix: string;
    propName: string;
    emitName: string;
    items: {
      prop: CompilerDOM.DirectiveNode;
      source: string;
      offset: number | undefined;
    }[];
  }> = {};

  for (const prop of node.props) {
    if (
      prop.type === CompilerDOM.NodeTypes.DIRECTIVE && (
        prop.name === "on" &&
        prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION &&
        prop.arg.isStatic ||
        options.vueCompilerOptions.strictVModel &&
        prop.name === "model" && (
          !prop.arg || prop.arg.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic
        )
      )
    ) {
      let source = prop.arg?.loc.source ?? "model-value";
      let offset = prop.arg?.loc.start.offset;
      let propPrefix = "on-";
      let emitPrefix = "";
      if (prop.name === "model") {
        propPrefix = "onUpdate:";
        emitPrefix = "update:";
      }
      else if (source.startsWith("vue:")) {
        source = source.slice("vue:".length);
        offset = offset! + "vue:".length;
        propPrefix = "onVnode-";
        emitPrefix = "vnode-";
      }
      const propName = camelize(propPrefix + source);
      const emitName = emitPrefix + source;
      const key = [
        prop.name,
        propName,
        ...prop.modifiers.map((modifier) => modifier.content),
      ].join("+");

      definitions[key] ??= {
        propPrefix,
        emitPrefix,
        propName,
        emitName,
        items: [],
      };
      definitions[key].items.push({
        prop,
        source,
        offset,
      });
    }

    if (!Object.keys(definitions).length) {
      return;
    }

    const emitsVar = ctx.getInternalVariable();
    yield `let ${emitsVar}!: ${helpers.ResolveEmits}<typeof ${componentVar}, typeof ${getCtxVar()}.emit>${endOfLine}`;

    for (const { propPrefix, propName, emitName, items } of Object.values(definitions)) {
      yield `const ${ctx.getInternalVariable()}: ${helpers.ResolveEvent}<typeof ${getPropsVar()}, typeof ${emitsVar}, "${propName}", "${emitName}", "${camelize(emitName)}"> = {${newLine}`;
      for (const { prop, source, offset } of items) {
        if (prop.name === "on") {
          yield* generateEventArg(options, source, offset!, propPrefix.slice(0, -1));
          yield `: `;
          yield* generateEventExpression(options, ctx, prop);
        }
        else {
          yield `"${propName}": `;
          yield* generateModelEventExpression(options, ctx, prop);
        }
        yield `,${newLine}`;
      }
      yield `}${endOfLine}`;
    }
  }
}

export function* generateEventArg(
  options: TemplateCodegenOptions,
  name: string,
  start: number,
  prefix = "on",
  features?: CodeInformation,
): Generator<Code> {
  features ??= options.vueCompilerOptions.checkUnknownEvents
    ? codeFeatures.verification
    : codeFeatures.doNotReportTs2353AndTs2561;

  if (prefix.length) {
    name = capitalize(name);
  }

  const boundary = yield* Boundary.start("template", start, start + name.length, features);
  if (identifierRE.test(camelize(name))) {
    yield prefix;
    yield* generateCamelized(name, "template", start, boundary.features);
  }
  else {
    yield `"`;
    yield prefix;
    yield* generateCamelized(name, "template", start, boundary.features);
    yield `"`;
  }
  yield boundary.end();
}

export function* generateEventExpression(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
  if (prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
    const { program: ast } = parseSync("dummy.ts", prop.exp.content);

    const isCompound = isCompoundExpression(ast, prop.exp.content);
    const interpolation = generateInterpolation(
      options,
      ctx,
      options.template,
      prop.exp.content,
      prop.exp.loc.start.offset,
      codeFeatures.verification,
      isCompound ? `` : `(`,
      isCompound ? `` : `)`,
    );

    if (isCompound) {
      yield `(...[$event]) => {${newLine}`;
      const scope = ctx.scope();
      scope.declare("$event");
      yield* ctx.generateConditionGuards();
      if (isSingleExpression(ast, prop.exp.content)) {
        yield `return (`;
        yield* interpolation;
        yield `)`;
      }
      else {
        yield* interpolation;
      }
      yield endOfLine;
      scope.end();
      yield `}`;
    }
    else {
      yield* interpolation;
    }
  }
  else {
    yield `() => {}`;
  }
}

export function* generateModelEventExpression(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  prop: CompilerDOM.DirectiveNode,
): Generator<Code> {
  if (prop.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION) {
    yield `(...[$event]) => {${newLine}`;
    yield* ctx.generateConditionGuards();
    yield* generateInterpolation(
      options,
      ctx,
      options.template,
      prop.exp.content,
      prop.exp.loc.start.offset,
      codeFeatures.verification,
    );
    yield ` = $event${endOfLine}`;
    yield `}`;
  }
  else {
    yield `() => {}`;
  }
}

function isCompoundExpression(ast: Program, text: string) {
  if (ast.body.length === 0) {
    return false;
  }
  if (ast.body.length === 1 && text[ast.body[0].end - 1] !== ";") {
    const statement = ast.body[0];
    if (statement.type === "ExpressionStatement") {
      const node = getUnwrappedExpression(statement.expression);
      if (
        node.type === "ArrowFunctionExpression" ||
        node.type === "Identifier" ||
        node.type === "MemberExpression"
      ) {
        return false;
      }
    }
    else if (statement.type === "FunctionDeclaration") {
      return false;
    }
  }
  return true;
}

function isSingleExpression(ast: Program, text: string) {
  if (ast.body.length === 1 && text[ast.body[0].end - 1] !== ";") {
    const statement = ast.body[0]!;
    if (statement.type === "ExpressionStatement") {
      return true;
    }
  }
  return false;
}
