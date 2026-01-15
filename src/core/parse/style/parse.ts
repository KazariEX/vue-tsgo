const bindingRE = /\bv-bind\(\s*(?:'([^']+)'|"([^"]+)"|([a-z_]\w*))\s*\)/gi;
const classNameRE = /(?=(\.[a-z_][-\w]*)[\s.,+~>:#)[{])/gi;
const commentRE = /(?<=\/\*)[\s\S]*?(?=\*\/)|(?<=\/\/)[\s\S]*?(?=\n)/g;
const fragmentRE = /(?<=\{)[^{]*(?=(?<!\\);)/g;

export function* parseStyleBindings(css: string) {
    css = fillBlank(css, commentRE);
    const matchs = css.matchAll(bindingRE);
    for (const match of matchs) {
        const matchText = match.slice(1).find((t) => t);
        if (matchText) {
            const offset = match.index + css.slice(match.index).indexOf(matchText);
            yield { offset, text: matchText };
        }
    }
}

export function* parseStyleClassNames(css: string) {
    css = fillBlank(css, commentRE, fragmentRE);
    const matches = css.matchAll(classNameRE);
    for (const match of matches) {
        const matchText = match[1];
        if (matchText) {
            yield { offset: match.index, text: matchText };
        }
    }
}

function fillBlank(css: string, ...regexps: RegExp[]) {
    for (const regexp of regexps) {
        css = css.replace(regexp, (match) => " ".repeat(match.length));
    }
    return css;
}
