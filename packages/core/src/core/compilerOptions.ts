import { readFileSync } from "node:fs";
import { getDefaultCompilerOptions, type RawVueCompilerOptions, type VueCompilerOptions } from "@vue/language-core";
import { camelize } from "@vue/shared";
import resolver from "oxc-resolver";
import { hyphenateTag } from "./shared";

const syntaxRE = /^\s*@(?<key>\w+)\b(?<value>.+)/m;

export function parseLocalCompilerOptions(comments: string[]) {
  // eslint-disable-next-line array-callback-return
  const entries = comments.map((text) => {
    try {
      const match = syntaxRE.exec(text);
      if (match) {
        const { key, value } = match.groups!;
        return [key, JSON.parse(value)];
      }
    }
    catch {}
  }).filter((item) => !!item);

  if (entries.length) {
    return Object.fromEntries(entries) as RawVueCompilerOptions;
  }
}

export function createCompilerOptionsBuilder() {
  const resolved: Omit<RawVueCompilerOptions, "target" | "strictTemplates" | "typesRoot" | "plugins"> = {};
  let target: number | undefined;

  function add(options: RawVueCompilerOptions, rootDir: string) {
    for (const key in options) {
      switch (key) {
        case "target": {
          if (options[key] === "auto") {
            target = resolveVueVersion(rootDir);
          }
          else {
            target = options[key];
          }
          break;
        }
        case "strictTemplates": {
          const strict = !!options[key];
          resolved.strictVModel ??= strict;
          resolved.checkUnknownProps ??= strict;
          resolved.checkUnknownEvents ??= strict;
          resolved.checkUnknownDirectives ??= strict;
          resolved.checkUnknownComponents ??= strict;
          break;
        }
        default: {
          // @ts-expect-error ...
          resolved[key] = options[key];
          break;
        }
      }
    }

    if (options.target === void 0) {
      target ??= resolveVueVersion(rootDir);
    }
  }

  function build(defaults = getDefaultCompilerOptions(target, resolved.lib)): VueCompilerOptions {
    return {
      ...defaults,
      ...resolved,
      macros: {
        ...defaults.macros,
        ...resolved.macros,
      },
      composables: {
        ...defaults.composables,
        ...resolved.composables,
      },
      fallthroughComponentNames: [
        ...defaults.fallthroughComponentNames,
        ...resolved.fallthroughComponentNames ?? [],
      ].map(hyphenateTag),
      experimentalModelPropName: Object.fromEntries(
        Object.entries(
          resolved.experimentalModelPropName ?? defaults.experimentalModelPropName,
        ).map(([k, v]) => [camelize(k), v]),
      ),
    };
  }

  return {
    add,
    build,
  };
}

function resolveVueVersion(folder: string) {
  const { packageJsonPath } = resolver.sync(folder, "vue/package.json");
  if (packageJsonPath === void 0) {
    return;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const version = packageJson.version as string;
  const [major, minor] = version.split(".");
  return Number(major + "." + minor);
}
