const cssBindingReg = /\bv-bind\(\s*(?:'([^']+)'|"([^"]+)"|([a-z_]\w*))\s*\)/gi;
const cssClassNameReg = /(?=(\.[a-z_][-\w]*)[\s.,+~>:#)[{])/gi;
const commentReg = /(?<=\/\*)[\s\S]*?(?=\*\/)|(?<=\/\/)[\s\S]*?(?=\n)/g;
const fragmentReg = /(?<=\{)[^{]*(?=(?<!\\);)/g;

export function* parseStyleBindings(css: string) {
    css = fillBlank(css, commentReg);
    const matchs = css.matchAll(cssBindingReg);
    for (const match of matchs) {
        const matchText = match.slice(1).find((t) => t);
        if (matchText) {
            const offset = match.index + css.slice(match.index).indexOf(matchText);
            yield { offset, text: matchText };
        }
    }
}

export function* parseStyleClassNames(css: string) {
    css = fillBlank(css, commentReg, fragmentReg);
    const matches = css.matchAll(cssClassNameReg);
    for (const match of matches) {
        const matchText = match[1];
        if (matchText) {
            yield { offset: match.index, text: matchText };
        }
    }
}

function fillBlank(css: string, ...regs: RegExp[]) {
    for (const reg of regs) {
        css = css.replace(reg, (match) => " ".repeat(match.length));
    }
    return css;
}
