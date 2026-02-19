/**
 * Regression tests for the virtual TypeScript code generated from Vue SFC templates.
 *
 * Each test calls `createSourceFile` with a `.vue` snippet and inspects the generated
 * `virtualText` to verify that TypeScript expressions in template attributes are emitted
 * correctly — in particular that identifiers inside TypeScript *type* positions (e.g.
 * keys of object-type literals) are NOT incorrectly prefixed with `__VLS_ctx.`.
 *
 * Using `@nuxt/ui`'s Accordion.vue as a source of real-world test cases, since it is
 * where I've noticed these issues first-hand.
 *
 * @see https://github.com/nuxt/ui
 */
import { getDefaultCompilerOptions } from "@vue/language-core";
import { describe, expect, it } from "vitest";
import { createSourceFile } from "../src/core/codegen";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal VueCompilerOptions suitable for testing. */
function makeVueCompilerOptions() {
    return getDefaultCompilerOptions();
}

/**
 * Generate the virtual TypeScript text for a given SFC source string.
 * `sourcePath` must end with a recognised extension (`.vue` by default).
 */
function generateVirtual(source: string, sourcePath = "Test.vue"): string {
    const sf = createSourceFile(sourcePath, source, makeVueCompilerOptions());
    if (sf.type !== "virtual") {
        throw new Error("Expected a virtual file to be generated");
    }
    return sf.virtualText;
}

// ---------------------------------------------------------------------------
// Tests: TypeScript type-literal keys in `as` casts (TS1005 / TS1109 regression)
// ---------------------------------------------------------------------------

describe("template interpolation codegen — TS type-literal key preservation", () => {
    /**
     * Regression: `(item as Extract<T, { slot: string; }>)` — the `slot` identifier
     * inside the type-literal `{ slot: string; }` was incorrectly being treated as a
     * runtime value and rewritten to `__VLS_ctx.slot`, producing invalid TS syntax:
     *   `{ __VLS_ctx.slot: string; }`
     * This caused TS1005/TS1109 errors in the generated .ts file.
     */
    it("does not mangle property keys inside an `as Extract<T, { key: Type }>`  cast", () => {
        const src = `
<script setup lang="ts">
const items = [{ slot: 'custom', label: 'Hello' }]
</script>
<template>
  <div v-for="(item, index) in items" :key="index">
    <slot :item="(item as Extract<typeof item, { slot: string; }>)" />
  </div>
</template>
`;
        const vt = generateVirtual(src);

        // The type literal key `slot` must NOT be prefixed with `__VLS_ctx.`
        expect(vt).not.toContain("__VLS_ctx.slot:");
        expect(vt).not.toContain("__VLS_ctx.slot }");

        // The original `as Extract<...>` cast should be preserved verbatim
        expect(vt).toContain("Extract<");
        expect(vt).toContain("{ slot: string; }");
    });

    it("does not mangle method-signature keys inside a type-literal cast", () => {
        const src = `
<script setup lang="ts">
type Handlers = { onClick(): void }
const x = { onClick: () => {} }
</script>
<template>
  <div :data-x="(x as Handlers)['onClick']" />
</template>
`;
        const vt = generateVirtual(src);
        // onClick as a value-level MemberExpression key should remain, but any
        // identifier inside a TSMethodSignature type position must NOT be rewritten.
        expect(vt).not.toContain("__VLS_ctx.onClick:");
    });

    it("does not mangle multiple property keys in a multi-property type literal", () => {
        const src = `
<script setup lang="ts">
const item = { slot: 'x', label: 'y' }
</script>
<template>
  <span :title="String((item as { slot: string; label: string }).slot)" />
</template>
`;
        const vt = generateVirtual(src);

        expect(vt).not.toContain("__VLS_ctx.slot:");
        expect(vt).not.toContain("__VLS_ctx.label:");
        expect(vt).toContain("{ slot: string; label: string }");
    });

    /**
     * The parent slot-outlet pattern from nuxt/ui Accordion.vue line 131:
     * <slot :name="((item.slot || 'content') as keyof AccordionSlots<T>)"
     *       :item="(item as Extract<T, { slot: string; }>)" ...>
     *
     * The `slot` inside `{ slot: string; }` must survive unchanged.
     */
    it("handles the nuxt/ui Accordion pattern — slot name cast and Extract item cast", () => {
        const src = `
<script lang="ts">
export interface AccordionItem {
  slot?: string
  content?: string
  label?: string
}
export type AccordionSlots<T extends AccordionItem = AccordionItem> = {
  content(props: { item: T }): any
  [key: string]: any
}
</script>
<script setup lang="ts" generic="T extends AccordionItem">
const props = defineProps<{ items?: T[] }>()
const slots = defineSlots<AccordionSlots<T>>()
</script>
<template>
  <div v-for="(item, index) in props.items" :key="index">
    <slot
      :name="((item.slot || 'content') as keyof AccordionSlots<T>)"
      :item="(item as Extract<T, { slot: string; }>)"
      :index="index"
    />
  </div>
</template>
`;
        const vt = generateVirtual(src);

        // Phase 1: type-literal key guard (the bug)
        expect(vt).not.toContain("__VLS_ctx.slot:");

        // Phase 2: the Extract cast itself must be preserved
        expect(vt).toContain("Extract<");

        // Phase 3: the keyof cast must also survive
        expect(vt).toContain("keyof");
        expect(vt).toContain("AccordionSlots");
    });

    /**
     * Plain `as` casts on runtime values must still be preserved — no regression.
     */
    it("preserves basic `as` casts on runtime identifiers (no regression)", () => {
        const src = `
<script setup lang="ts">
const val: unknown = true
</script>
<template>
  <div v-if="val as boolean" />
</template>
`;
        const vt = generateVirtual(src);
        expect(vt).toContain("as boolean");
    });

    /**
     * An `as keyof SomeType<T>` subscript access should NOT be mangled.
     * This covers the `v-if` condition on AccordionContent (line 130 of nuxt/ui Accordion.vue).
     */
    it("preserves `slots[expr as keyof SomeType<T>]` without mangling the type", () => {
        const src = `
<script lang="ts">
export interface AccordionItem { slot?: string; content?: string }
export type AccordionSlots<T extends AccordionItem = AccordionItem> = {
  content(props: { item: T }): any
  [key: string]: any
}
</script>
<script setup lang="ts" generic="T extends AccordionItem">
const props = defineProps<{ items?: T[] }>()
const slots = defineSlots<AccordionSlots<T>>()
</script>
<template>
  <div
    v-for="(item, index) in props.items"
    :key="index"
    v-if="item.content || (item.slot && !!slots[item.slot as keyof AccordionSlots<T>])"
  />
</template>
`;
        const vt = generateVirtual(src);

        // `keyof AccordionSlots<T>` — the type reference identifiers must NOT be rewritten
        expect(vt).toContain("keyof AccordionSlots");
        // No mangling of type-level names
        expect(vt).not.toContain("__VLS_ctx.AccordionSlots");
        expect(vt).not.toContain("__VLS_ctx.keyof");
    });
});
