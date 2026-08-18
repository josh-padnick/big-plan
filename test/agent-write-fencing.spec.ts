// BIG-122. The one journey that proves a lapsed agent cannot reach the
// authoritative plan source. It crosses every real boundary the failure used
// to escape through: a browser-sent comment, two real `big-plan agent`
// processes, a lease that lapses mid-edit, and the reviewer's own Was/Now.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveSnapshotDigest,
  readAgentExchange,
} from "../src/review/agent-exchange.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  readSnapshot,
  writeAgentRequestValue,
  writeStoreJson,
} from "../src/review/store.js";
import type { ReviewStore } from "../src/review/store.js";
import {
  expect,
  runAgentCli,
  runRefusedAgentCli,
  stageComment,
  test,
  closeReviewRuntime,
} from "./fixtures";

const PLAN = `# Lapsed lease

The plan starts with one committed section.

## Recovery

The agent explains what happens when a claim lapses mid-edit.
`;

const HALF_WRITTEN = "Agent A stopped mid-sentence and";
const AFTER_TAKEOVER = "Agent A kept typing after losing the claim";

const tokenOf = (stdout: string): string => {
  const token = /agent_token: ([a-f0-9]{16})/u.exec(stdout)?.[1];
  if (token === undefined) {
    throw new Error(`The agent CLI returned no claim token:\n${stdout}`);
  }
  return token;
};

const candidateOf = (stdout: string): string => {
  const candidate = /candidate_plan: (\S+)/u.exec(stdout)?.[1];
  if (candidate === undefined) {
    throw new Error(`The agent CLI returned no candidate plan:\n${stdout}`);
  }
  return candidate;
};

const responseDraftOf = (stdout: string): string => {
  const draft = /response_file: (\S+)/u.exec(stdout)?.[1];
  if (draft === undefined) {
    throw new Error(`The agent CLI returned no response file:\n${stdout}`);
  }
  return draft;
};

test("should keep a lapsed agent's edits out of the plan and its Was/Now", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-write-fencing-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const commentBody = "Name the recovery path for a lapsed claim.";
    await stageComment(page, commentBody);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await sent).ok()).toBe(true);

    const committedSource = await readFile(planPath, "utf8");

    // Agent A claims the work and is handed its own draft copy to edit.
    const firstClaim = await runAgentCli(["next", planPath, "--wait"]);
    const firstToken = tokenOf(firstClaim.stdout);
    const firstCandidate = candidateOf(firstClaim.stdout);
    await expect(readFile(firstCandidate, "utf8")).resolves.toBe(
      committedSource,
    );
    await writeFile(
      firstCandidate,
      `${committedSource}\n## Half-written\n\n${HALF_WRITTEN}\n`,
      "utf8",
    );
    await expect(readFile(planPath, "utf8")).resolves.toBe(committedSource);

    // The lease lapses while agent A is still mid-edit.
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) => candidate.kind === "feedback",
    );
    if (request === undefined) {
      throw new Error("The browser never queued the feedback request");
    }
    await writeAgentRequestValue({
      store: runtime.store,
      requestId: request.requestId,
      value: { ...request, claimExpiresAtMs: Date.now() - 1_000 },
    });

    // Agent B takes over and starts from the last committed revision.
    const secondClaim = await runAgentCli(["next", planPath, "--wait"]);
    const secondToken = tokenOf(secondClaim.stdout);
    const secondCandidate = candidateOf(secondClaim.stdout);
    expect(secondToken).not.toBe(firstToken);
    expect(secondCandidate).not.toBe(firstCandidate);
    await expect(readFile(secondCandidate, "utf8")).resolves.toBe(
      committedSource,
    );

    // Agent A keeps writing after the takeover. Its own copy changes; the
    // authoritative source does not.
    await writeFile(
      firstCandidate,
      `${committedSource}\n## Half-written\n\n${HALF_WRITTEN} ${AFTER_TAKEOVER}\n`,
      "utf8",
    );
    await expect(readFile(planPath, "utf8")).resolves.toBe(committedSource);

    // Agent A's finished answer is refused for the generation it lost.
    const firstDraft = responseDraftOf(firstClaim.stdout);
    await writeFile(
      firstDraft,
      JSON.stringify({
        requestId: request.requestId,
        outcomes: request.comments.map((comment) => ({
          commentId: comment.id,
          state: "answered",
          message: "Agent A answers after losing its claim.",
        })),
      }),
      "utf8",
    );
    const refused = await runRefusedAgentCli([
      "respond",
      planPath,
      firstDraft,
      "--agent",
      firstToken,
    ]);
    expect(`${refused.stdout}${refused.stderr}`).toContain(
      "this claim generation can no longer publish",
    );
    await expect(
      readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
    ).resolves.toMatchObject({ responses: [] });
    await expect(readFile(planPath, "utf8")).resolves.toBe(committedSource);

    // Agent B publishes its own revision through the one commit boundary.
    const revised = committedSource.replace(
      "The agent explains what happens when a claim lapses mid-edit.",
      "A lapsed claim keeps its edits private, so a takeover starts clean.",
    );
    await writeFile(secondCandidate, revised, "utf8");
    const secondDraft = responseDraftOf(secondClaim.stdout);
    await writeFile(
      secondDraft,
      JSON.stringify({
        requestId: request.requestId,
        outcomes: request.comments.map((comment) => ({
          commentId: comment.id,
          state: "changed",
          message: "Named the recovery path for a lapsed claim.",
          changeTargets: ["section/recovery/paragraph-1"],
        })),
      }),
      "utf8",
    );
    const published = await runAgentCli([
      "respond",
      planPath,
      secondDraft,
      "--agent",
      secondToken,
    ]);
    expect(published.stdout).toContain(`responded: ${request.requestId}`);
    await expect(readFile(planPath, "utf8")).resolves.toBe(revised);

    // Was and Now are the committed pair, so neither carries agent A's text.
    const settled = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const answered = settled.requests.find(
      (candidate) => candidate.requestId === request.requestId,
    );
    const response = settled.responses.find(
      (candidate) => candidate.requestId === request.requestId,
    );
    if (answered?.baselineSnapshot === undefined || response === undefined) {
      throw new Error("The takeover never published a committed revision");
    }
    const wasSource = await readSnapshot({
      store: runtime.store,
      snapshot: answered.baselineSnapshot,
    });
    const nowSource = await readSnapshot({
      store: runtime.store,
      snapshot: response.resultSnapshot,
    });
    expect(wasSource).toBe(committedSource);
    expect(nowSource).toBe(revised);
    expect(wasSource).not.toContain(HALF_WRITTEN);
    expect(nowSource).not.toContain(HALF_WRITTEN);

    await page.reload();
    await expect(page.locator("article")).toContainText(
      "A lapsed claim keeps its edits private",
    );
    await expect(page.locator("article")).not.toContainText(HALF_WRITTEN);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// Recovery is proved through the real CLI, because the guarantee is that the
// agent's next command settles the interrupted commit before it answers
// anything. The two crash states are built exactly as a crash leaves them: a
// prepared journal, and a plan file on one side of the rename or the other.
const interruptedCommit = async ({
  runtime,
  requestId,
  claimedBy,
  generation,
  response,
  baseSnapshot,
  resultSnapshot,
}: {
  readonly runtime: { readonly store: ReviewStore };
  readonly requestId: string;
  readonly claimedBy: string;
  readonly generation: number;
  readonly response: unknown;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
}): Promise<void> => {
  await writeStoreJson({
    path: join(
      runtime.store.agentMutationJournalDirectory,
      `${requestId}.json`,
    ),
    value: {
      version: 1,
      requestId,
      generation,
      claimedBy,
      baseSnapshot,
      resultSnapshot,
      answeredAt: "2026-08-17T12:00:05.000Z",
      response,
    },
  });
};

test("should settle an interrupted commit before the agent gets more work", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-commit-recovery-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await rail
      .getByPlaceholder("Ask about the plan as a whole…")
      .fill("What happens when the commit is interrupted?");
    await rail.getByRole("button", { name: "Send", exact: true }).click();

    const committedSource = await readFile(planPath, "utf8");
    const claim = await runAgentCli(["next", planPath, "--wait"]);
    const agentToken = tokenOf(claim.stdout);
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests[0];
    if (request?.claimGeneration === undefined) {
      throw new Error("The pickup recorded no claim generation");
    }
    const published = `${committedSource}\n## Interrupted\n\nThe swap either happened or it did not.\n`;
    const response = {
      version: 3,
      kind: "chat",
      requestId: request.requestId,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
      claimGeneration: request.claimGeneration,
      resultSnapshot: deriveSnapshotDigest(published),
      createdAt: "2026-08-17T12:00:05.000Z",
      message: "The interrupted commit is settled.",
    };
    const journal = {
      runtime,
      requestId: request.requestId,
      claimedBy: agentToken,
      generation: request.claimGeneration,
      response,
      baseSnapshot: deriveSnapshotDigest(committedSource),
      resultSnapshot: deriveSnapshotDigest(published),
    };

    // The process died before the rename. The next command finds the plan at
    // its base revision, so nothing committed and the request stays open.
    await interruptedCommit(journal);
    const resumed = await runAgentCli([
      "next",
      planPath,
      "--agent",
      agentToken,
    ]);
    expect(resumed.stdout).toContain("pending: true");
    await expect(readFile(planPath, "utf8")).resolves.toBe(committedSource);
    await expect(
      readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
    ).resolves.toMatchObject({ responses: [] });

    // The process died after the rename. The plan already carries the result,
    // so the same answer is finished before any more work is served.
    await interruptedCommit(journal);
    await writeFile(planPath, published, "utf8");
    const afterRename = await runAgentCli(["next", planPath]);
    expect(afterRename.stdout).toContain("pending: false");
    const settled = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    expect(settled.requests[0]?.answeredAt).toBe("2026-08-17T12:00:05.000Z");
    expect(settled.responses[0]).toMatchObject({
      message: "The interrupted commit is settled.",
    });

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(rail).toContainText("The interrupted commit is settled.");
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should stop agent edits when the plan matches neither side of a commit", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-source-conflict-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await rail
      .getByPlaceholder("Ask about the plan as a whole…")
      .fill("Who else writes this file?");
    await rail.getByRole("button", { name: "Send", exact: true }).click();

    const committedSource = await readFile(planPath, "utf8");
    const claim = await runAgentCli(["next", planPath, "--wait"]);
    const agentToken = tokenOf(claim.stdout);
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests[0];
    if (request?.claimGeneration === undefined) {
      throw new Error("The pickup recorded no claim generation");
    }
    const published = `${committedSource}\n## Published\n\nThe result that never landed.\n`;
    await interruptedCommit({
      runtime,
      requestId: request.requestId,
      claimedBy: agentToken,
      generation: request.claimGeneration,
      baseSnapshot: deriveSnapshotDigest(committedSource),
      resultSnapshot: deriveSnapshotDigest(published),
      response: {
        version: 3,
        kind: "chat",
        requestId: request.requestId,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
        claimGeneration: request.claimGeneration,
        resultSnapshot: deriveSnapshotDigest(published),
        createdAt: "2026-08-17T12:00:05.000Z",
        message: "This answer never becomes public.",
      },
    });
    // A writer outside Big Plan changed the file while the commit was open.
    const foreign = `${committedSource}\n## Hand edit\n\nSomeone edited the plan outside the review.\n`;
    await writeFile(planPath, foreign, "utf8");

    const refused = await runRefusedAgentCli(["next", planPath]);
    expect(`${refused.stdout}${refused.stderr}`).toContain(
      "matches neither side of an interrupted commit",
    );
    // The conflict is reported, never resolved by overwriting the file.
    await expect(readFile(planPath, "utf8")).resolves.toBe(foreign);
    await expect(
      readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
    ).resolves.toMatchObject({ responses: [] });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
