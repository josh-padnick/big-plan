// Proves that starting the review runtime yields to a live runtime already
// serving the same plan, and seizes custody only when that is asked for.
// A silent seizure makes the other reviewer's open page and its connected
// agent read-only with nothing said to either of them.

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAgentExchange } from "./agent-exchange.js";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import {
  ReviewCustodyHeld,
  reviewSessionOwnsMailbox,
} from "./session-authority.js";
import type { ReviewStore } from "./store.js";

const PLAN = `# Custody plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that a second start silently takes the review away.
`;

// The diff-preview seed is the loudest shared write a start performs: it stores
// sent comments, drafts, agent requests, claims, and terminal responses.
const PREVIEW_PLAN = `# Custody plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that the preview seed lands in someone else's review.
`;

/** Every stored file under one review store, by path and exact content. */
const storeContents = async (
  store: ReviewStore,
): Promise<ReadonlyArray<readonly [string, string]>> => {
  const entries = await readdir(store.root, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries.filter((entry) => entry.isFile());
  return Promise.all(
    files
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map(
        async (path) =>
          [path, await readFile(path, "utf8")] as readonly [string, string],
      ),
  );
};

const sentCommentCount = async (store: ReviewStore): Promise<number> => {
  const parsed: unknown = JSON.parse(await readFile(store.sentPath, "utf8"));
  return Array.isArray(parsed) ? parsed.length : -1;
};

/** The sessions that own the stored agent requests, in the order stored. */
const requestSessionIds = async (
  runtime: ReviewRuntime,
): Promise<ReadonlyArray<string>> => {
  const exchange = await readAgentExchange({
    store: runtime.store,
    sessionId: runtime.sessionId,
    planId: runtime.planId,
  });
  return exchange.requests.map((request) => request.sessionId);
};

const running: Array<ReviewRuntime> = [];
const directories: Array<string> = [];

const planFile = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-custody-"));
  directories.push(directory);
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  return planPath;
};

const start = async (
  options: Parameters<typeof startReviewRuntime>[0],
): Promise<ReviewRuntime> => {
  const runtime = await startReviewRuntime(options);
  running.push(runtime);
  return runtime;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map(async (one) => one.close()));
  await Promise.all(
    directories
      .splice(0)
      .map(async (one) => rm(one, { recursive: true, force: true })),
  );
});

describe("review runtime custody", () => {
  it("should yield to the live runtime already serving the plan", async () => {
    const planPath = await planFile();
    const live = await start({ planPath });

    const held = await start({ planPath }).catch(
      (error: unknown) => error as unknown,
    );

    expect(held).toBeInstanceOf(ReviewCustodyHeld);
    expect((held as ReviewCustodyHeld).live).toMatchObject({
      sessionId: live.sessionId,
      url: live.url,
      plan: live.planPath,
    });
    await expect(
      reviewSessionOwnsMailbox({
        store: live.store,
        sessionId: live.sessionId,
      }),
    ).resolves.toBe(true);
    // The yielding start must leave the live session serving, not merely
    // unreplaced.
    await expect(
      fetch(live.url).then((response) => response.status),
    ).resolves.toBe(200);
  });

  it("should seize custody from a live runtime on an explicit takeover", async () => {
    const planPath = await planFile();
    const live = await start({ planPath });

    const seized = await start({ planPath, takeover: true });

    expect(seized.replacedSession).toMatchObject({
      sessionId: live.sessionId,
      url: live.url,
    });
    await expect(
      reviewSessionOwnsMailbox({
        store: live.store,
        sessionId: live.sessionId,
      }),
    ).resolves.toBe(false);
    await expect(
      reviewSessionOwnsMailbox({
        store: seized.store,
        sessionId: seized.sessionId,
      }),
    ).resolves.toBe(true);
  });

  it("should take custody normally once the previous runtime has stopped", async () => {
    const planPath = await planFile();
    const previous = await start({ planPath });
    await previous.close();

    const next = await start({ planPath });

    expect(next.replacedSession).toBe(undefined);
    await expect(
      reviewSessionOwnsMailbox({
        store: next.store,
        sessionId: next.sessionId,
      }),
    ).resolves.toBe(true);
  });

  it("should write nothing into a store another live runtime owns", async () => {
    const planPath = await planFile();
    const live = await start({ planPath });
    const before = await storeContents(live.store);

    const held = await start({
      planPath,
      diffPreviewSource: PREVIEW_PLAN,
    }).catch((error: unknown) => error as unknown);

    expect(held).toBeInstanceOf(ReviewCustodyHeld);
    // A refused start must be inert: no snapshot, no seeded comments, no agent
    // requests in a review it does not own.
    await expect(storeContents(live.store)).resolves.toEqual(before);
  });

  it("should let only the winner of a tie write shared review state", async () => {
    const planPath = await planFile();

    const outcomes = await Promise.all([
      start({ planPath, diffPreviewSource: PREVIEW_PLAN }).catch(
        (error: unknown) => error as unknown,
      ),
      start({ planPath, diffPreviewSource: PREVIEW_PLAN }).catch(
        (error: unknown) => error as unknown,
      ),
    ]);

    const winners = outcomes.filter(
      (one): one is ReviewRuntime => !(one instanceof Error),
    );
    expect(winners).toHaveLength(1);
    const [winner] = winners;
    if (winner === undefined) throw new Error("no runtime won the plan");
    // The loser writes nothing, so every seeded request belongs to the session
    // that actually holds the plan. A start that seeded before losing custody
    // leaves requests owned by a session that never existed.
    await expect(sentCommentCount(winner.store)).resolves.toBe(1);
    const owners = await requestSessionIds(winner);
    expect(owners.length).toBeGreaterThan(0);
    expect([...new Set(owners)]).toEqual([winner.sessionId]);
  });

  it("should let exactly one of two simultaneous starts win the plan", async () => {
    const planPath = await planFile();

    const [first, second] = await Promise.all([
      start({ planPath }).catch((error: unknown) => error as unknown),
      start({ planPath }).catch((error: unknown) => error as unknown),
    ]);

    const outcomes = [first, second];
    const winners = outcomes.filter(
      (one): one is ReviewRuntime => !(one instanceof Error),
    );
    const losers = outcomes.filter(
      (one): one is ReviewCustodyHeld => one instanceof ReviewCustodyHeld,
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const [winner] = winners;
    const [loser] = losers;
    expect(loser?.live.sessionId).toBe(winner?.sessionId);
    expect(loser?.live.url).toBe(winner?.url);
  });
});
