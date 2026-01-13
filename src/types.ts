import type { Segment } from "muggle-string";

export interface CodeInformation {
    verification?: boolean | {
        shouldReport?: (source: string | undefined, code: string | number | undefined) => boolean;
    };
    __combineToken?: symbol;
}

export type Code = Segment<CodeInformation>;
