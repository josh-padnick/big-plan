// Covers the pieces of runtime state whose meaning is not obvious from their
// shape: the snapshot the browser is allowed to reload advances on the first
// sighting of an agent response and never again, the write gate gives up on
// one mutation rather than on the whole session (BIG-44), and the decision
// answer revision a runtime serves never moves backwards.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDecisionAnswers,
  createReaderProgress,
  createWriteGate,
} from "./review-route-context.js";
import { prepareStore, reviewStoreFor } from "./store.js";
import {
  createMutationRegistry,
  ReviewWriteStalled,
} from "./runtime-watchdog.js";

const created: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createReaderProgress", () => {
  it("starts at the snapshot the runtime opened on", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    expect(progress.currentSnapshot()).toBe("aaaa");
  });

  it("advances on the first sighting of a response", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });

    expect(progress.currentSnapshot()).toBe("bbbb");
  });

  it("ignores a response it has already seen", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });
    progress.accept("cccc");
    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });

    expect(progress.currentSnapshot()).toBe("cccc");
  });

  it("treats responses present when the runtime started as already seen", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: ["r1"],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });

    expect(progress.currentSnapshot()).toBe("aaaa");
  });

  it("advances to the last unseen response when several arrive together", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: ["r1"],
    });

    for (const response of [
      { requestId: "r1", resultSnapshot: "bbbb" },
      { requestId: "r2", resultSnapshot: "cccc" },
      { requestId: "r3", resultSnapshot: "dddd" },
    ]) {
      progress.observe(response);
    }

    expect(progress.currentSnapshot()).toBe("dddd");
  });

  it("accepts a snapshot the reviewer reverted to", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });
    progress.accept("aaaa");

    expect(progress.currentSnapshot()).toBe("aaaa");
  });
});

describe("createDecisionAnswers", () => {
  const answersFor = async () => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-context-"));
    created.push(directory);
    const planPath = join(directory, "plan.mdx");
    await writeFile(planPath, "# Plan\n");
    const store = reviewStoreFor({ planPath, planId: "0123456789abcdef" });
    await prepareStore(store);
    const diagnostics: Array<string> = [];
    const answers = createDecisionAnswers({
      store,
      resolvedPlanPath: planPath,
      reportDiagnostic: ({ message }) => {
        diagnostics.push(message);
      },
    });
    return { store, answers, diagnostics };
  };

  it("holds the served revision when the record becomes unreadable", async () => {
    const { store, answers, diagnostics } = await answersFor();
    await answers.write({ version: 1, revision: 3, answers: [] });
    await writeFile(store.inputsPath, "not json");

    const served = await answers.read();

    expect(served.revision).toBe(3);
    expect(served.answers).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });

  it("holds the served answer body over an out-of-band older record", async () => {
    const { store, answers } = await answersFor();
    await answers.write({
      version: 1,
      revision: 3,
      answers: [
        {
          decisionId: "decision",
          optionId: "option",
          optionTitle: "Option",
          prompt: "Choose an option",
          answeredAt: "2026-08-18T12:00:00.000Z",
          premiseSnapshot: "2222222222222222",
          decisionDigest: "1111111111111111",
        },
      ],
    });
    await writeFile(
      store.inputsPath,
      `${JSON.stringify({ version: 1, revision: 1, answers: [] })}\n`,
    );

    await expect(answers.read()).resolves.toMatchObject({
      revision: 3,
      answers: [expect.objectContaining({ decisionId: "decision" })],
    });
  });

  it("serves the stored revision once it catches back up", async () => {
    const { store, answers } = await answersFor();
    await answers.write({ version: 1, revision: 2, answers: [] });
    await writeFile(
      store.inputsPath,
      `${JSON.stringify({ version: 1, revision: 5, answers: [] })}\n`,
    );

    expect((await answers.read()).revision).toBe(5);
  });
});

describe("createWriteGate", () => {
  const gateFor = (stallMs: number) =>
    createWriteGate({ mutations: createMutationRegistry(), stallMs });

  it("runs one mutation at a time in the order they arrived", async () => {
    const gate = gateFor(1_000);
    const order: Array<string> = [];
    let active = 0;
    let mostActive = 0;
    const write = (name: string) =>
      gate.exclusively({
        route: `PUT /api/${name}`,
        work: async () => {
          active += 1;
          mostActive = Math.max(mostActive, active);
          await new Promise((settle) => setTimeout(settle, 5));
          active -= 1;
          order.push(name);
        },
      });

    await Promise.all([write("first"), write("second"), write("third")]);

    expect(order).toEqual(["first", "second", "third"]);
    expect(mostActive).toBe(1);
  });

  it("gives up on one mutation that never settles and runs the next", async () => {
    const gate = gateFor(40);
    const stuck = gate.exclusively({
      route: "PUT /api/drafts",
      work: () => new Promise<void>(() => undefined),
    });

    await expect(stuck).rejects.toBeInstanceOf(ReviewWriteStalled);
    await expect(
      gate.exclusively({
        route: "POST /api/feedback",
        work: async () => "written",
      }),
    ).resolves.toBe("written");
  });

  it("reports how long the oldest abandoned mutation has been stuck", async () => {
    const gate = gateFor(20);
    expect(gate.stalledForMs()).toBeUndefined();

    await gate
      .exclusively({
        route: "PUT /api/drafts",
        work: () => new Promise<void>(() => undefined),
      })
      .catch(() => undefined);

    // The give-up timer can fire a fraction before the wall clock has passed
    // the same bound, and the stall reading is taken from the clock. Poll for
    // the reading rather than assert on that tie.
    await vi.waitFor(() => {
      expect(gate.stalledForMs()).toBeGreaterThanOrEqual(20);
    });
  });

  it("reports no stall for a mutation that is merely still running", async () => {
    const gate = gateFor(60_000);
    let release = (): void => undefined;
    const held = new Promise<void>((settle) => {
      release = settle;
    });
    const running = gate.exclusively({
      route: "PUT /api/drafts",
      work: () => held,
    });
    await new Promise((settle) => setTimeout(settle, 5));

    expect(gate.stalledForMs()).toBeUndefined();
    release();
    await running;
    expect(gate.stalledForMs()).toBeUndefined();
  });
});
