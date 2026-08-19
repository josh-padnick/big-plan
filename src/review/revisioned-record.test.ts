// Proves a revisioned runtime record never labels a stale read body with a
// newer committed revision when writes keep overtaking its retries.

import { describe, expect, it } from "vitest";
import { createRevisionedRecord } from "./revisioned-record.js";

describe("createRevisionedRecord", () => {
  it("should return the committed body when every bounded read is overtaken", async () => {
    type Record = { readonly revision: number; readonly value: string };
    let readNumber = 0;
    let record: ReturnType<typeof createRevisionedRecord<Record>>;
    record = createRevisionedRecord<Record>({
      initial: { revision: 0, value: "initial" },
      readStored: async () => {
        const stale = { revision: readNumber, value: `stale-${readNumber}` };
        readNumber += 1;
        await record.write({
          revision: readNumber,
          value: `committed-${readNumber}`,
        });
        return stale;
      },
      writeStored: async () => undefined,
    });

    await expect(record.read()).resolves.toEqual({
      revision: 4,
      value: "committed-4",
    });
  });

  it("should retain the complete committed body over an older stored record", async () => {
    const record = createRevisionedRecord({
      initial: { revision: 0, value: "initial" },
      readStored: async () => ({ revision: 1, value: "stale" }),
      writeStored: async () => undefined,
    });
    await record.write({ revision: 3, value: "committed" });

    await expect(record.read()).resolves.toEqual({
      revision: 3,
      value: "committed",
    });
  });
});
