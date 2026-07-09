import type { CodeInformation } from "../types";

const raw = {
  none: {},
  verification: {
    verification: true,
  },
  doNotReportTs2339AndTs2551: {
    verification: {
      // https://typescript.tv/errors/#ts2339
      // https://typescript.tv/errors/#ts2551
      shouldReport: (code) => code !== 2339 && code !== 2551,
    },
  },
  doNotReportTs2353AndTs2561: {
    verification: {
      // https://typescript.tv/errors/#ts2353
      // https://typescript.tv/errors/#ts2561
      shouldReport: (code) => code !== 2353 && code !== 2561,
    },
  },
  doNotReportTs6133: {
    verification: {
      // https://typescript.tv/errors/#ts6133
      shouldReport: (code) => code !== 6133,
    },
  },
} satisfies Record<string, CodeInformation>;

export const codeFeatures = raw as {
  [K in keyof typeof raw]: CodeInformation;
};
