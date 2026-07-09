export const names = define({
  // @keep-sorted
  ...{
    base: "",
    componentsOption: "",
    ctx: "",
    defaultModels: "",
    defaults: "",
    directives: "",
    directivesOption: "",
    dollars: "",
    emit: "",
    export: "",
    exposed: "",
    intrinsics: "",
    modelEmit: "",
    omit: "",
    props: "",
    propsOption: "",
    self: "",
    setup: "",
    slots: "",
  },
  // @keep-sorted
  ...{
    Emit: "",
    EmitProps: "",
    GlobalComponents: "",
    InheritedAttrs: "",
    LocalComponents: "",
    LocalDirectives: "",
    ModelEmit: "",
    ModelProps: "",
    Props: "",
    PublicProps: "",
    RootEl: "",
    SetupExposed: "",
    Slots: "",
    StyleModules: "",
    TemplateRefs: "",
  },
});

/** @generated */
export const helpers = define({
  asFunctionalComponent0: "",
  asFunctionalComponent1: "",
  asFunctionalDirective: "",
  asFunctionalElement0: "",
  asFunctionalElement1: "",
  asFunctionalSlot: "",
  directiveBindingRestFields: "",
  functionalComponentArgsRest: "",
  tryAsConstant: "",
  vFor: "",
  vSlot: "",
  ConstructorOverloads: "",
  Elements: "",
  EmitsToProps: "",
  FunctionalComponent0: "",
  FunctionalComponent1: "",
  FunctionalComponentCtx: "",
  FunctionalComponentProps: "",
  IsAny: "",
  IsFunction: "",
  NormalizeComponentEvent: "",
  NormalizeEmits: "",
  OverloadUnion: "",
  OverloadUnionInner: "",
  PickNotAny: "",
  PrettifyGlobal: "",
  ResolveDirectives: "",
  ResolveEmits: "",
  ShortEmits: "",
  ShortEmitsToObject: "",
  SpreadMerge: "",
  UnionToIntersection: "",
  WithComponent: "",
});

function define<T extends Record<string, string>>(raw: T) {
  return Object.fromEntries(
    Object.keys(raw).map((key) => [key, `__VLS_${key}`]),
  ) as {
    [K in keyof T]: `__VLS_${K & string}`;
  };
}
