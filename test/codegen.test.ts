import { getDefaultCompilerOptions } from "@vue/language-core";
import { describe, expect, it } from "vitest";
import { createSourceFile } from "../src/core/codegen";

const vueCompilerOptions = getDefaultCompilerOptions();

function generateVirtualText(source: string, sourcePath = "dummy.vue") {
    const sourceFile = createSourceFile(sourcePath, source, vueCompilerOptions);
    if (sourceFile.type !== "virtual") {
        throw new Error("Expected a virtual file to be generated.");
    }
    return sourceFile.virtualText;
}

describe("interpolation", () => {
    it("property key", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="{ foo: bar, baz }"/>
            </template>
            `),
        ).toContain("{ foo: __VLS_ctx.bar, baz: __VLS_ctx.baz }");
    });

    it("member expression", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo.bar.baz"/>
            </template>
            `),
        ).toContain("__VLS_ctx.foo.bar.baz");

        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo.bar[baz]"/>
            </template>
            `),
        ).toContain("__VLS_ctx.foo.bar[__VLS_ctx.baz]");
    });

    it("ts function parameter", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo as (arg: string) => void"/>
            </template>
            `),
        ).toContain("(arg: string) => void");
    });

    it("ts method key", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo as { bar(arg: string): void }"/>
            </template>
            `),
        ).toContain("{ bar(arg: string): void }");
    });

    it("ts property key", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo as { bar: string }"/>
            </template>
            `),
        ).toContain("{ bar: string }");
    });

    it("ts reference", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo as Foo<string>"/>
            </template>
            `),
        ).toContain("as Foo<string>");
    });

    it("ts type query", () => {
        expect(
            generateVirtualText(/* html */`
            <template>
                <slot :foo="foo as typeof bar"/>
            </template>
            `),
        ).toContain("as typeof __VLS_ctx.bar");
    });
});
