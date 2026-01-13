import type { Comment, Node } from "oxc-parser";

export interface Range {
    start: number;
    end: number;
}

export function getRange(node: Node | Comment): Range {
    return {
        start: node.start,
        end: node.end,
    };
}

const whitespaceOnlyRE = /^\s*$/;

/**
 * Copied from https://github.com/oxc-project/oxc/blob/3002649/apps/oxlint/src-js/plugins/comments.ts#L42-L79
 */
export function getLeadingComments(node: Node, source: string, comments: Comment[]): Comment[] {
    let targetStart = node.start;
    let sliceStart = comments.length;
    let sliceEnd = 0;

    for (let low = 0, high = comments.length; low < high;) {
        const mid = (low + high) >> 1;
        if (comments[mid].end <= targetStart) {
            sliceEnd = low = mid + 1;
        }
        else {
            high = mid;
        }
    }

    for (let i = sliceEnd - 1; i >= 0; i--) {
        const comment = comments[i];
        const gap = source.slice(comment.end, targetStart);
        if (whitespaceOnlyRE.test(gap)) {
            sliceStart = i;
            targetStart = comment.start;
        }
        else break;
    }

    return comments.slice(sliceStart, sliceEnd);
}

export function getClosestMultiLineCommentRange(
    node: Node,
    source: string,
    comments: Comment[],
): Range | undefined {
    const comment = getLeadingComments(node, source, comments).findLast((c) => c.type === "Block");
    if (comment) {
        return getRange(comment);
    }
}
