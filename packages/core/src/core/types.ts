import type { Segment } from "muggle-string";

export interface CodeInformation {
  verification?: boolean | {
    shouldReport: (code: number) => boolean;
  };
  __combineToken?: symbol;
}

export type Code = Segment<CodeInformation>;
