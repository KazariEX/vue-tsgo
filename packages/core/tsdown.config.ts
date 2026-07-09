import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    cli: "./src/cli/index.ts",
  },
  dts: {
    tsgo: true,
  },
  exports: {
    exclude: ["cli"],
  },
});
