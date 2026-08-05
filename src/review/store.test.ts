import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendProgress,
  prepareStore,
  readActiveDraft,
  readProgress,
  reviewStoreFor,
  writeActiveDraft,
} from "./store.js";

const created: Array<string> = [];

const temporaryPlan = async () => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-store-"));
  created.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, "# Plan\n");
  return { directory, planPath };
};

afterEach(() => {
  created.length = 0;
});

describe("review store placement", () => {
  it("should put every artifact under one .big-plan beside the plan", async () => {
    const { directory, planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    for (const path of [
      store.reviewDirectory,
      store.feedbackDirectory,
      store.draftsPath,
      store.activeDraftPath,
      store.sentPath,
      store.progressPath,
      store.sessionPath,
    ]) {
      expect(path.startsWith(join(directory, ".big-plan"))).toBe(true);
    }
  });

  it("should namespace review state by the plan id and nothing else", async () => {
    const { planPath } = await temporaryPlan();
    const one = reviewStoreFor({ planPath, planId: "aaaaaaaaaaaaaaaa" });
    const other = reviewStoreFor({ planPath, planId: "bbbbbbbbbbbbbbbb" });
    expect(one.draftsPath).not.toBe(other.draftsPath);
  });

  it("should refuse a plan id that would climb out of the review directory", async () => {
    const { planPath } = await temporaryPlan();
    expect(() =>
      reviewStoreFor({ planPath, planId: "../../../../etc" }),
    ).toThrow(/outside/);
  });
});

describe("review store active draft", () => {
  it("should round-trip the unfinished whole-plan field without trimming", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeActiveDraft({
      path: store.activeDraftPath,
      value: "  Unfinished thought.\n",
    });
    expect(
      await readActiveDraft({
        path: store.activeDraftPath,
        validate: (value) => (typeof value === "string" ? value : ""),
      }),
    ).toBe("  Unfinished thought.\n");
  });
});

describe("review store creation", () => {
  it("should create the review directories readable only by their owner", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const mode = (await stat(store.reviewDirectory)).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("should keep review state out of version control by default", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    expect(await readFile(join(store.root, ".gitignore"), "utf8")).toContain(
      "*",
    );
  });
});

describe("review store progress relay", () => {
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;

  const storeWithProgress = async (contents: string) => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await writeFile(store.progressPath, contents);
    return store;
  };

  it("should relay an event that belongs to the running session", async () => {
    const store = await storeWithProgress(
      line({ sessionId: "s1", seq: 1, step: "Revising", state: "live" }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([
      { sessionId: "s1", seq: 1, step: "Revising", state: "live" },
    ]);
  });

  it("should drop an event written for another session", async () => {
    const store = await storeWithProgress(
      line({ sessionId: "other", seq: 1, step: "Ready", state: "done" }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([]);
  });

  it("should drop an event that does not advance the sequence", async () => {
    const store = await storeWithProgress(
      line({ sessionId: "s1", seq: 2, step: "Revising", state: "live" }) +
        line({ sessionId: "s1", seq: 1, step: "Replayed", state: "done" }),
    );
    const events = await readProgress({ store, sessionId: "s1" });
    expect(events.map((event) => event.step)).toEqual(["Revising"]);
  });

  it("should drop an event carrying a state the surface cannot show", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 1,
        step: "Redirect",
        state: "navigate:https://evil.example.com",
      }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toEqual([]);
  });

  it("should survive a hand-edited status file rather than failing the session", async () => {
    const store = await storeWithProgress(
      "not json at all\n" +
        line({ sessionId: "s1", seq: 1, step: "Revising", state: "live" }),
    );
    expect(await readProgress({ store, sessionId: "s1" })).toHaveLength(1);
  });

  it("should bound the text a relayed event can carry", async () => {
    const store = await storeWithProgress(
      line({
        sessionId: "s1",
        seq: 1,
        step: "x".repeat(500),
        state: "live",
      }),
    );
    const [event] = await readProgress({ store, sessionId: "s1" });
    expect(event?.step.length).toBe(160);
  });

  it("should read back an event the runtime itself appended", async () => {
    const { planPath } = await temporaryPlan();
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    await appendProgress({
      store,
      event: {
        sessionId: "s1",
        seq: 1,
        step: "Feedback package received",
        state: "done",
      },
    });
    expect(await readProgress({ store, sessionId: "s1" })).toHaveLength(1);
  });
});
