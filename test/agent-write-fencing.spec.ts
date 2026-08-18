// BIG-122. The one journey that proves a lapsed agent cannot reach the
// authoritative plan source. It crosses every real boundary the failure used
// to escape through: a browser-sent comment, two real `big-plan agent`
// processes, a lease that lapses mid-edit, and the reviewer's own Was/Now.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentExchange } from "../src/review/agent-exchange.js";
import { startReviewRuntime } from "../src/review/server.js";
import { readSnapshot, writeAgentRequestValue } from "../src/review/store.js";
import {
  expect,
  runAgentCli,
  runRefusedAgentCli,
  stageComment,
  test,
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
      "no longer holds the claim",
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
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
