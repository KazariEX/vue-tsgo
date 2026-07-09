const bindingRE = /\bv-bind\s*\(/g;
const classNameRE = /\.[a-z_][-\w]*(?=[\s.,+~>:#)[{])/gi;
const commentRE = /(?<=\/\*)[\s\S]*?(?=\*\/)|(?<=\/\/)[\s\S]*?(?=\n)/g;
const fragmentRE = /(?<=\{)[^{]*(?=(?<!\\);)/g;

export function* parseStyleBindings(css: string) {
  css = fillBlank(css, commentRE);
  for (const match of css.matchAll(bindingRE)) {
    const start = match.index + match[0].length;
    const end = lexBinding(css, start);
    if (end !== null) {
      yield trimQuotes(css.slice(start, end), start);
    }
  }
}

enum LexerState {
  inParens,
  inSingleQuoteString,
  inDoubleQuoteString,
}

// https://github.com/vuejs/core/blob/c0606e9/packages/compiler-sfc/src/style/cssVars.ts#L93
function lexBinding(content: string, start: number) {
  let state: LexerState = LexerState.inParens;
  let parenDepth = 0;

  for (let i = start; i < content.length; i++) {
    const char = content.charAt(i);
    switch (state) {
      case LexerState.inParens:
        if (char === `'`) {
          state = LexerState.inSingleQuoteString;
        }
        else if (char === `"`) {
          state = LexerState.inDoubleQuoteString;
        }
        else if (char === `(`) {
          parenDepth++;
        }
        else if (char === `)`) {
          if (parenDepth > 0) {
            parenDepth--;
          }
          else {
            return i;
          }
        }
        break;
      case LexerState.inSingleQuoteString:
        if (char === `'`) {
          state = LexerState.inParens;
        }
        break;
      case LexerState.inDoubleQuoteString:
        if (char === `"`) {
          state = LexerState.inParens;
        }
        break;
    }
  }
  return null;
}

export function* parseStyleClassNames(css: string) {
  css = fillBlank(css, commentRE, fragmentRE);
  for (const match of css.matchAll(classNameRE)) {
    yield { text: match[0], offset: match.index };
  }
}

function fillBlank(css: string, ...regexps: RegExp[]) {
  for (const regexp of regexps) {
    css = css.replace(regexp, (match) => " ".repeat(match.length));
  }
  return css;
}

function trimQuotes(text: string, offset: number) {
  let start = 0;
  let end = text.length;

  if (text.includes("\"") || text.includes("'")) {
    while (start < text.length && !text[start]?.trim()) {
      start++;
    }
    while (end >= 0 && !text[end - 1]?.trim()) {
      end--;
    }
  }

  if (
    text[start] === "\"" && text[end - 1] === "\"" ||
    text[start] === "'" && text[end - 1] === "'"
  ) {
    start++;
    end--;
  }

  return {
    text: text.slice(start, end),
    offset: offset + start,
  };
}
