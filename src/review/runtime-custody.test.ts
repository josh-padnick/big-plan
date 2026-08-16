// Proves that starting the review runtime yields to a live runtime already
// serving the same plan, and seizes custody only when that is asked for.
// A silent seizure makes the other reviewer's open page and its connected
// agent read-only with nothing said to either of them.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startReviewRuntime } from "./server.js";
import type { ReviewRuntime } from "./server.js";
import {
  ReviewCustodyHeld,
  reviewSessionOwnsMailbox,
} from "./session-authority.js";

const PLAN = `# Custody plan

The runtime serves this document and nothing else.

## Status quo

Today's reality is that a second start silently takes the review away.
`;

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
