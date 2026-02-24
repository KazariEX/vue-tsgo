# Vue Tsgo

[![version](https://img.shields.io/npm/v/vue-tsgo?color=007EC7&label=npm)](https://www.npmjs.com/package/vue-tsgo)
[![downloads](https://img.shields.io/npm/dm/vue-tsgo?color=007EC7&label=downloads)](https://www.npmjs.com/package/vue-tsgo)
[![license](https://img.shields.io/npm/l/vue-tsgo?color=007EC7&label=license)](/LICENSE)

Type checker for Vue SFCs with TypeScript 7 integration.

This project includes a lightweight subset of [@vue/language-core](https://github.com/vuejs/language-tools/tree/master/packages/language-core) designed for type checking only environments.

It works by emulating TypeScript's path resolution behavior when creating a project, writing a virtual workspace into a temporary directory, where all Vue SFCs are transformed into real TS files and handed off to `tsgo --lsp` for type checking.

## Installation

```bash
pnpm i -D vue-tsgo
```

## Usage

```bash
# single project
pnpm vue-tsgo --project .nuxt/tsconfig.app.json
# multiple projects (references)
pnpm vue-tsgo --build
```
