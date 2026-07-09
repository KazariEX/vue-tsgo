import CompilerDOM from "@vue/compiler-dom";
import { getAttributeValueOffset, getElementTagOffsets } from "../../shared";
import { codeFeatures } from "../codeFeatures";
import { helpers, names } from "../names";
import { endOfLine, newLine } from "../utils";
import { Boundary, generateBoundary } from "../utils/boundary";
import { generateElementProps, generatePropExp } from "./elementProps";
import { generateInterpolation } from "./interpolation";
import { generatePropertyAccess } from "./propertyAccess";
import { generateTemplateChild } from "./templateChild";
import type { Code } from "../../types";
import type { TemplateCodegenContext } from "./context";
import type { TemplateCodegenOptions } from "./index";

export function* generateSlotOutlet(
  options: TemplateCodegenOptions,
  ctx: TemplateCodegenContext,
  node: CompilerDOM.SlotOutletNode,
): Generator<Code> {
  const [tagLocStart] = getElementTagOffsets(node, options.template);
  const tagLocEnd = tagLocStart + node.tag.length;
  const propsVar = ctx.getInternalVariable();
  const nameProp = node.props.find((prop) => (
    prop.type === CompilerDOM.NodeTypes.ATTRIBUTE
      ? prop.name === "name"
      : prop.name === "bind" && prop.arg?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
        ? prop.arg.content === "name"
        : false
  ));

  if (options.hasDefineSlots) {
    yield `${helpers.asFunctionalSlot}(`;
    if (nameProp) {
      let codes: Iterable<Code>;
      if (nameProp.type === CompilerDOM.NodeTypes.ATTRIBUTE && nameProp.value) {
        codes = generatePropertyAccess(
          options,
          ctx,
          nameProp.value.content,
          getAttributeValueOffset(nameProp.value),
          codeFeatures.verification,
        );
      }
      else if (
        nameProp.type === CompilerDOM.NodeTypes.DIRECTIVE &&
        nameProp.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
      ) {
        codes = [
          `[`,
          ...generatePropExp(
            options,
            ctx,
            nameProp,
            nameProp.exp,
          ),
          `]`,
        ];
      }
      else {
        codes = [`["default"]`];
      }

      const boundary = yield* Boundary.start(
        "template",
        nameProp.loc.start.offset,
        nameProp.loc.end.offset,
        codeFeatures.verification,
      );
      yield options.slotsAssignName ?? names.slots;
      yield* codes;
      yield boundary.end();
    }
    else {
      const boundary = yield* Boundary.start(
        "template",
        tagLocStart,
        tagLocEnd,
        codeFeatures.verification,
      );
      yield `${options.slotsAssignName ?? names.slots}[`;
      yield* generateBoundary(
        "template",
        tagLocStart,
        tagLocEnd,
        codeFeatures.verification,
        `"default"`,
      );
      yield `]`;
      yield boundary.end();
    }
    yield `)(`;
    const boundary = yield* Boundary.start(
      "template",
      tagLocStart,
      tagLocEnd,
      codeFeatures.verification,
    );
    yield `{${newLine}`;
    yield* generateElementProps(
      options,
      ctx,
      node,
      node.props.filter((prop) => prop !== nameProp),
      true,
    );
    yield `}`;
    yield boundary.end();
    yield `)${endOfLine}`;
  }
  else {
    yield `var ${propsVar} = {${newLine}`;
    yield* generateElementProps(
      options,
      ctx,
      node,
      node.props,
      options.vueCompilerOptions.checkUnknownProps,
    );
    yield `}${endOfLine}`;

    if (nameProp?.type === CompilerDOM.NodeTypes.ATTRIBUTE && nameProp.value) {
      ctx.slots.push({
        name: nameProp.value.content,
        offset: getAttributeValueOffset(nameProp.value),
        propsVar: ctx.getHoistVariable(propsVar),
      });
    }
    else if (
      nameProp?.type === CompilerDOM.NodeTypes.DIRECTIVE &&
      nameProp.exp?.type === CompilerDOM.NodeTypes.SIMPLE_EXPRESSION
    ) {
      const expVar = ctx.getInternalVariable();
      yield `var ${expVar} = ${helpers.tryAsConstant}(`;
      yield* generateInterpolation(
        options,
        ctx,
        options.template,
        nameProp.exp.content,
        nameProp.exp.loc.start.offset,
        codeFeatures.verification,
      );
      yield `)${endOfLine}`;

      ctx.dynamicSlots.push({
        expVar: ctx.getHoistVariable(expVar),
        propsVar: ctx.getHoistVariable(propsVar),
      });
    }
    else {
      ctx.slots.push({
        name: "default",
        propsVar: ctx.getHoistVariable(propsVar),
      });
    }
  }

  for (const child of node.children) {
    yield* generateTemplateChild(options, ctx, child);
  }
}
