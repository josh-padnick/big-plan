// The progress log is the one review file whose cost grows with the length of
// the session it belongs to: the browser polls it about forty times a minute
// and every appended event allocates its sequence from it. These tests hold it
// to reading each line once and to staying bounded (BIG-44).

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ fullFileReads: 0 }));

// The filesystem is the boundary this measures, so it is the boundary that is
// wrapped: everything still reaches the real disk, and only the count of
// whole-file reads is observed.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      const [path] = args;
      if (typeof path === "string" && path.endsWith("progress.jsonl")) {
        counters.fullFileReads += 1;
      }
      return actual.readFile(...args);
    },
  };
});

const {
  appendProgressValue,
  compactProgressLog,
  nextProgressSequence,
  prepareStore,
  readProgress,
  reviewStoreFor,
} = await import("./store.js");
const { appendProgressEvent } = await import("./request-mailbox.js");

const SESSION = "a".repeat(16);
const OTHER_SESSION = "b".repeat(16);

const temporaryStore = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
  await prepareStore(store);
  return { directory, store };
};

const seed = async ({
  store,
  count,
  sessionId = SESSION,
  from = 1,
}: {
  readonly store: ReturnType<typeof reviewStoreFor>;
  readonly count: number;
  readonly sessionId?: string;
  readonly from?: number;
}) => {
  for (let index = 0; index < count; index += 1) {
    await appendProgressValue({
      store,
      event: {
        sessionId,
        seq: from + index,
        stepCode: "agent-note",
        step: `Step ${from + index}`,
        state: "live",
      },
    });
  }
};

const lineCount = async (path: string): Promise<number> =>
  (await readFile(path, "utf8")).split("\n").filter((line) => line !== "")
    .length;

const directories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("the progress log", () => {
  it("should not reparse the whole history to append one event", async () => {
    const { directory, store } = await temporaryStore(
      "big-plan-progress-cost-",
    );
    directories.push(directory);
    counters.fullFileReads = 0;

    for (let index = 0; index < 500; index += 1) {
      await appendProgressEvent({
        store,
        event: {
          sessionId: SESSION,
          stepCode: "agent-note",
          step: `Step ${index}`,
          state: "live",
        },
      });
    }

    // Without the cache this is one whole-file read per appended event, and
    // each one parses everything written before it.
    expect(counters.fullFileReads).toBeLessThanOrEqual(2);
    const events = await readProgress({ store, sessionId: SESSION });
    expect(events).toHaveLength(200);
    expect(events.at(0)?.seq).toBe(301);
    expect(events.at(-1)?.seq).toBe(500);
  });

  it("should read an event appended by another writer", async () => {
    const { directory, store } = await temporaryStore(
      "big-plan-progress-tail-",
    );
    directories.push(directory);

    await seed({ store, count: 3 });
    expect(await readProgress({ store, sessionId: SESSION })).toHaveLength(3);
    await seed({ store, count: 2, from: 4 });

    const events = await readProgress({ store, sessionId: SESSION });
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(await nextProgressSequence({ store, sessionId: SESSION })).toBe(6);
  });

  it("should answer from the file after it is rewritten underneath", async () => {
    const { directory, store } = await temporaryStore(
      "big-plan-progress-swap-",
    );
    directories.push(directory);

    await seed({ store, count: 40 });
    expect(await readProgress({ store, sessionId: SESSION })).toHaveLength(40);

    // A shorter file is what compaction by any other process leaves behind.
    await writeFile(
      store.progressPath,
      `${JSON.stringify({
        sessionId: SESSION,
        seq: 41,
        stepCode: "agent-note",
        step: "Only survivor",
        state: "live",
      })}\n`,
    );

    const events = await readProgress({ store, sessionId: SESSION });
    expect(events.map((event) => event.step)).toEqual(["Only survivor"]);
  });

  it("should compact the log beyond its bound and keep the readable tail", async () => {
    const { directory, store } = await temporaryStore(
      "big-plan-progress-compact-",
    );
    directories.push(directory);

    await seed({ store, count: 1_200 });
    const before = await readProgress({ store, sessionId: SESSION });
    expect(await lineCount(store.progressPath)).toBe(1_200);

    await expect(compactProgressLog({ store })).resolves.toBe(true);

    expect(await lineCount(store.progressPath)).toBe(200);
    expect(await readProgress({ store, sessionId: SESSION })).toEqual(before);
    expect(await nextProgressSequence({ store, sessionId: SESSION })).toBe(
      1_201,
    );
  });

  it("should leave a log inside its bound untouched", async () => {
    const { directory, store } = await temporaryStore(
      "big-plan-progress-small-",
    );
    directories.push(directory);

    await seed({ store, count: 300 });

    await expect(compactProgressLog({ store })).resolves.toBe(false);
    expect(await lineCount(store.progressPath)).toBe(300);
  });

  it("should keep every session's own window when they share one log", async () => {
    const { directory, store } = await temporaryStore(
      "big-plan-progress-shared-",
    );
    directories.push(directory);

    await seed({ store, count: 900 });
    await seed({ store, count: 300, sessionId: OTHER_SESSION });
    const mine = await readProgress({ store, sessionId: SESSION });
    const theirs = await readProgress({ store, sessionId: OTHER_SESSION });

    await expect(compactProgressLog({ store })).resolves.toBe(true);

    expect(await readProgress({ store, sessionId: SESSION })).toEqual(mine);
    expect(await readProgress({ store, sessionId: OTHER_SESSION })).toEqual(
      theirs,
    );
    expect(await lineCount(store.progressPath)).toBe(400);
  });
});
