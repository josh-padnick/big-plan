// Owns monotonic runtime reads for revisioned review records whose filesystem
// reads can race serialized writes.

const CONCURRENT_WRITE_REREADS = 3;

type RevisionedRecord = { readonly revision: number };

/** Keeps the last committed body when repeated reads are overtaken by writes. */
export const createRevisionedRecord = <TRecord extends RevisionedRecord>({
  initial,
  readStored,
  writeStored,
}: {
  readonly initial: TRecord;
  readonly readStored: () => Promise<TRecord>;
  readonly writeStored: (record: TRecord) => Promise<void>;
}): {
  readonly read: () => Promise<TRecord>;
  readonly write: (record: TRecord) => Promise<void>;
} => {
  let committed = initial;
  let writes = 0;
  return {
    read: async () => {
      for (let attempt = 0; ; attempt += 1) {
        const startedAfter = writes;
        const stored = await readStored();
        if (writes !== startedAfter) {
          if (attempt < CONCURRENT_WRITE_REREADS) continue;
          return committed;
        }
        if (stored.revision < committed.revision) return committed;
        committed = stored;
        return stored;
      }
    },
    write: async (record) => {
      await writeStored(record);
      if (record.revision >= committed.revision) committed = record;
      writes += 1;
    },
  };
};
