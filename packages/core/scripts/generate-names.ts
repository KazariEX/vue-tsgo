import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "pathe";

const require = createRequire(import.meta.url);

const typesPath = require.resolve("@vue/language-core/types/template-helpers.d.ts");
const typesText = await readFile(typesPath, "utf-8");

const pascalNames = new Set<string>();
const camelNames = new Set<string>();

const declRE = /(?<=const\s+)\w*(?=:)|(?<=type\s+)\w*(?=\s*=|<)|(?<=function\s+)\w*(?=\(|<)/g;
const prefix = "__VLS_";

for (const match of typesText.matchAll(declRE)) {
  const name = match[0].slice(prefix.length);
  if (name[0]?.toUpperCase() === name[0]) {
    pascalNames.add(name);
  }
  else {
    camelNames.add(name);
  }
}

const namesPath = join(import.meta.dirname, "../src/core/codegen/names.ts");
const namesText = await readFile(namesPath, "utf-8");

await writeFile(
  namesPath,
  namesText.replace(
    /(?<=const helpers = define\(\{\n).*?(?=\}\))/s,
    [...camelNames].sort().map((name) => `  ${name}: "",\n`).join("") +
    [...pascalNames].sort().map((name) => `  ${name}: "",\n`).join(""),
  ),
);
