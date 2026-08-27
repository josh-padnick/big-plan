// Proves the shipped runtime invariants that live plan push will reuse:
// candidate edits stay hidden until respond commits, and the resulting article
// replacement preserves the reviewer's reading and composing context.

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "../src/review/agent-exchange.js";
import { readCommittedRevision } from "../src/review/change-set-commit.js";
import { claimAgentRequest } from "../src/review/request-mailbox.js";
import {
  writeAgentRequestValue,
  writeResolvedCommentIds,
} from "../src/review/store.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  agentIdOf,
  closeReviewRuntime,
  expect,
  runAgentCli,
  runRefusedAgentCli,
  stageComment,
  test,
  type Page,
} from "./fixtures";

/** What the settle probe records into the page, so the spec can read it back. */
type SettleRecord = { readonly settledBlockIds: ReadonlyArray<string> };

const PLAN = `# Live push runtime probe

The reviewer keeps reading while an agent prepares a revision.

${Array.from(
  { length: 28 },
  (_, index) =>
    `Reading context ${String(index + 1)} keeps the delivery section below the fold.`,
).join("\n\n")}

## Delivery boundary

The terminal response publishes the candidate atomically.

${Array.from(
  { length: 20 },
  (_, index) =>
    `Trailing context ${String(index + 1)} prevents the reading position from being clamped after refresh.`,
).join("\n\n")}
`;

const candidatePlanOf = (stdout: string): string => {
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

/** Sends the unchanged outcome that settles a push without publishing bytes. */
const settlePushWithoutChanges = async ({
  planPath,
  stdout,
}: {
  readonly planPath: string;
  readonly stdout: string;
}): Promise<void> => {
  const requestId = agentIdOf(stdout, "requestId");
  const threadId = agentIdOf(stdout, "threadId");
  const agentToken = agentIdOf(stdout, "agent_token");
  const connectionToken = agentIdOf(stdout, "connection_token");
  const responsePath = responseDraftOf(stdout);
  await writeFile(
    responsePath,
    JSON.stringify({
      requestId,
      outcomes: [
        {
          commentId: threadId,
          state: "answered",
          message: "No plan revision was needed.",
        },
      ],
    }),
    "utf8",
  );
  await runAgentCli([
    "respond",
    planPath,
    responsePath,
    "--agent",
    agentToken,
    "--connection",
    connectionToken,
  ]);
};

/** Cancels one request through the unchanged reviewer HTTP route. */
const cancelRequest = async (page: Page, requestId: string): Promise<void> => {
  const canceled = await page.evaluate(async (id) => {
    const root = document.documentElement;
    const response = await fetch("/api/agent-cancel", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
      body: JSON.stringify({ requestId: id }),
    });
    return response.ok;
  }, requestId);
  expect(canceled).toBe(true);
};

/** Reads the snapshot selected by the runtime's answered-gated agent payload. */
const agentSnapshot = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/agent", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    const payload: unknown = await response.json();
    return typeof payload === "object" &&
      payload !== null &&
      "currentSnapshot" in payload &&
      typeof payload.currentSnapshot === "string"
      ? payload.currentSnapshot
      : "";
  });

test("should reveal a real agent edit only at commit and preserve review context across the article swap", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-live-push-probe-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const previousModel = process.env.BIG_PLAN_AGENT_MODEL;
  process.env.BIG_PLAN_AGENT_MODEL = "live-push-probe-model";

  try {
    await page.goto(runtime.url);
    const requestBody = "Make the terminal publication boundary explicit.";
    await stageComment(page, requestBody);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);
    const thread = rail
      .locator("[data-review-sent-thread]")
      .filter({ hasText: requestBody });
    await thread
      .getByRole("button", { name: `Expand queued comment: ${requestBody}` })
      .click();
    await expect(
      thread.getByRole("button", { name: "Minimize thread" }).first(),
    ).toBeVisible();

    const deliverySlide = page.locator("[data-slide]").filter({
      has: page.getByRole("heading", { name: "Delivery boundary" }),
    });
    await deliverySlide.hover();
    await deliverySlide
      .getByRole("button", { name: "Comment on slide" })
      .click();
    const composerBody = "Keep this unfinished note through the live refresh.";
    const composer = page.getByRole("dialog", { name: /Comment on/u });
    await composer.getByLabel("Add a comment").fill(composerBody);
    await deliverySlide.scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      window.scrollBy({ top: 180, behavior: "instant" }),
    );
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    const baselineSnapshot = deriveSnapshotDigest(PLAN);
    await expect(agentSnapshot(page)).resolves.toBe(baselineSnapshot);
    const claim = await runAgentCli(["next", planPath, "--wait"]);
    const requestId = agentIdOf(claim.stdout, "requestId");
    const commentId = agentIdOf(claim.stdout, "- id");
    const agentToken = agentIdOf(claim.stdout, "agent_token");
    const candidatePath = candidatePlanOf(claim.stdout);
    const revised = PLAN.replace(
      "The terminal response publishes the candidate atomically.",
      "The terminal response publishes the staged candidate atomically.",
    );
    await writeFile(candidatePath, revised, "utf8");
    await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);

    await expect(agentSnapshot(page)).resolves.toBe(baselineSnapshot);
    await expect(page.locator("article")).toContainText(
      "publishes the candidate atomically",
    );
    await expect(page.locator("article")).not.toContainText(
      "publishes the staged candidate atomically",
    );

    const responsePath = responseDraftOf(claim.stdout);
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId,
        outcomes: [
          {
            commentId,
            state: "changed",
            message: "Made the publication boundary explicit.",
            changeTargets: ["section/delivery-boundary/paragraph-1"],
          },
        ],
      }),
      "utf8",
    );
    const published = await runAgentCli([
      "respond",
      planPath,
      responsePath,
      "--agent",
      agentToken,
    ]);
    expect(agentIdOf(published.stdout, "responded")).toBe(requestId);

    const resultSnapshot = deriveSnapshotDigest(revised);
    await expect.poll(() => agentSnapshot(page)).toBe(resultSnapshot);
    await expect(page.locator("article")).toContainText(
      "publishes the staged candidate atomically",
      { timeout: 15_000 },
    );
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
    await expect(
      thread.getByRole("button", { name: "Minimize thread" }).first(),
    ).toBeVisible();
    await expect(composer.getByLabel("Add a comment")).toHaveValue(
      composerBody,
    );
  } finally {
    if (previousModel === undefined) delete process.env.BIG_PLAN_AGENT_MODEL;
    else process.env.BIG_PLAN_AGENT_MODEL = previousModel;
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should review, reply to, and resolve a pushed thread in chat", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-live-push-review-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const previousModel = process.env.BIG_PLAN_AGENT_MODEL;
  process.env.BIG_PLAN_AGENT_MODEL = "live-push-review-model";

  try {
    await page.goto(runtime.url);
    const opened = await runAgentCli([
      "push",
      planPath,
      "--prompt",
      "Tighten the live publication explanation.",
    ]);
    const requestId = agentIdOf(opened.stdout, "requestId");
    const threadId = agentIdOf(opened.stdout, "threadId");
    const agentToken = agentIdOf(opened.stdout, "agent_token");
    const connectionToken = agentIdOf(opened.stdout, "connection_token");
    const candidatePath = candidatePlanOf(opened.stdout);
    const revised = PLAN.replace(
      "The reviewer keeps reading while an agent prepares a revision.",
      "The reviewer keeps reading while an agent safely prepares a revision.",
    ).replace(
      "The terminal response publishes the candidate atomically.",
      "The terminal response publishes the reviewed candidate atomically.",
    );
    await writeFile(candidatePath, revised, "utf8");
    await writeFile(
      responseDraftOf(opened.stdout),
      JSON.stringify({
        requestId,
        outcomes: [
          {
            commentId: threadId,
            state: "changed",
            message: "Clarified the safe publication flow.",
            changeTargets: [
              "document/paragraph-1",
              "section/delivery-boundary/paragraph-1",
            ],
          },
        ],
      }),
      "utf8",
    );
    await runAgentCli([
      "respond",
      planPath,
      responseDraftOf(opened.stdout),
      "--agent",
      agentToken,
      "--connection",
      connectionToken,
    ]);

    await expect(page.locator("article")).toContainText(
      "publishes the reviewed candidate atomically",
      { timeout: 15_000 },
    );
    // The arrival opens the rail on Chat itself, so pressing the toolbar
    // control here would close the rail this journey needs open.
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const thread = rail.locator(`[data-review-pushed-thread="${threadId}"]`);
    const pushedHeader = thread.getByRole("button", {
      name: "Added by agent",
    });
    await expect(pushedHeader).toBeVisible();
    await expect(pushedHeader.locator("svg")).toBeVisible();
    await expect(thread).not.toContainText("Reviewer-opened");
    await thread.getByRole("button", { name: /Expand pushed thread/u }).click();
    await expect(thread.getByText("You said", { exact: true })).toBeVisible();
    await expect(thread).toContainText(
      "Tighten the live publication explanation.",
    );

    const replyBody = "Keep the explanation focused on the atomic boundary.";
    const replyPosted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST",
    );
    await thread.getByPlaceholder("Reply to the agent…").fill(replyBody);
    await thread.getByRole("button", { name: "Reply" }).click();
    expect((await replyPosted).ok()).toBe(true);
    await expect
      .poll(async () => {
        const exchange = await readAgentExchange({
          store: runtime.store,
          sessionId: runtime.sessionId,
          planId: runtime.planId,
        });
        return exchange.requests.find(
          (request) => request.kind === "reply" && request.body === replyBody,
        );
      })
      .toMatchObject({ kind: "reply", commentId: threadId });

    const reply = await runAgentCli([
      "next",
      planPath,
      "--wait",
      "--agent",
      agentToken,
      "--connection",
      connectionToken,
    ]);
    const replyRequestId = agentIdOf(reply.stdout, "requestId");
    const replyAgentToken = agentIdOf(reply.stdout, "agent_token");
    await writeFile(
      responseDraftOf(reply.stdout),
      JSON.stringify({
        requestId: replyRequestId,
        outcomes: [
          {
            commentId: threadId,
            state: "answered",
            message: "The explanation now stays on that boundary.",
          },
        ],
      }),
      "utf8",
    );
    await runAgentCli([
      "respond",
      planPath,
      responseDraftOf(reply.stdout),
      "--agent",
      replyAgentToken,
      "--connection",
      connectionToken,
    ]);
    await expect(thread).toContainText(
      "The explanation now stays on that boundary.",
      { timeout: 15_000 },
    );

    await thread.getByRole("button", { name: /Review changes \(2\)/u }).click();
    const stepper = page.locator("[data-review-diff-stepper]");
    await expect(stepper).toContainText("1 of 2");
    await stepper.getByRole("button", { name: "Accept this change" }).click();
    await expect(stepper).toContainText("2 of 2");
    await stepper.getByRole("button", { name: "Accept this change" }).click();
    await page.keyboard.press("Escape");

    const continuedPush = await runAgentCli([
      "push",
      planPath,
      "--thread",
      threadId,
      "--prompt",
      "Clarify the follow-up publication step.",
      "--agent",
      replyAgentToken,
      "--connection",
      connectionToken,
    ]);
    const continuedRequestId = agentIdOf(continuedPush.stdout, "requestId");
    const continuedAgentToken = agentIdOf(continuedPush.stdout, "agent_token");
    const continuedRevision = revised.replace(
      "The reviewer keeps reading while an agent safely prepares a revision.",
      "The reviewer keeps reading while an agent safely prepares a follow-up revision.",
    );
    await writeFile(
      candidatePlanOf(continuedPush.stdout),
      continuedRevision,
      "utf8",
    );
    await writeFile(
      responseDraftOf(continuedPush.stdout),
      JSON.stringify({
        requestId: continuedRequestId,
        outcomes: [
          {
            commentId: threadId,
            state: "changed",
            message: "Clarified the follow-up publication flow.",
            changeTargets: ["document/paragraph-1"],
          },
        ],
      }),
      "utf8",
    );
    await runAgentCli([
      "respond",
      planPath,
      responseDraftOf(continuedPush.stdout),
      "--agent",
      continuedAgentToken,
      "--connection",
      connectionToken,
    ]);
    await expect(page.locator("article")).toContainText(
      "safely prepares a follow-up revision",
      { timeout: 15_000 },
    );

    const historicalChange = thread
      .locator('[data-review-message="agent"]')
      .filter({ hasText: "Clarified the safe publication flow." });
    await expect(
      historicalChange.getByText("Accepted", { exact: true }),
    ).toBeVisible();
    await historicalChange
      .getByRole("button", {
        name: /2 changes across 2 slides Accepted/u,
      })
      .click();
    await expect(
      stepper.getByRole("button", { name: "Resolve thread" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    const latestChange = thread
      .locator('[data-review-message="agent"]')
      .filter({ hasText: "Clarified the follow-up publication flow." });
    await latestChange.getByRole("button", { name: "Review change" }).click();
    await stepper.getByRole("button", { name: "Accept this change" }).click();
    await page.keyboard.press("Escape");

    await thread
      .getByRole("button", { name: "Revert response" })
      .first()
      .click();
    await page
      .getByRole("alertdialog", { name: "Revert response?" })
      .getByRole("button", { name: "Revert response" })
      .click();
    await expect(page.locator("article")).toContainText(
      "The terminal response publishes the reviewed candidate atomically.",
      { timeout: 15_000 },
    );
    await expect(
      thread.getByRole("button", { name: "Delete comment" }),
    ).toHaveCount(0);
    await expect(
      thread.getByRole("button", { name: "Resolve thread" }).first(),
    ).toBeVisible();

    const retainedReply = "Keep this draft while I archive the thread.";
    await thread.getByPlaceholder("Reply to the agent…").fill(retainedReply);
    await latestChange.getByRole("button", { name: "Review change" }).click();
    await expect(
      stepper.getByRole("button", { name: "Resolve thread" }),
    ).toBeVisible();
    await stepper.getByRole("button", { name: "Resolve thread" }).click();

    await rail.getByText("Resolved (1)").click();
    await expect(
      thread.getByRole("button", { name: "Unresolve thread" }).first(),
    ).toBeVisible();
    await expect(thread.getByPlaceholder("Reply to the agent…")).toHaveValue(
      retainedReply,
    );

    const about = await runAgentCli([
      "push",
      planPath,
      "--about",
      "I found a related wording concern.",
      "--agent",
      continuedAgentToken,
      "--connection",
      connectionToken,
    ]);
    await settlePushWithoutChanges({ planPath, stdout: about.stdout });
    const aboutThreadId = agentIdOf(about.stdout, "threadId");
    const aboutThread = rail.locator(
      `[data-review-pushed-thread="${aboutThreadId}"]`,
    );
    await expect(aboutThread).toContainText("Agent-opened", {
      timeout: 15_000,
    });
    await expect(aboutThread).toContainText("About");

    const continued = await runAgentCli([
      "push",
      planPath,
      "--thread",
      aboutThreadId,
      "--prompt",
      "Keep that concern in this conversation.",
      "--agent",
      agentIdOf(about.stdout, "agent_token"),
      "--connection",
      connectionToken,
    ]);
    await settlePushWithoutChanges({ planPath, stdout: continued.stdout });
    await expect(rail.locator(`[data-review-pushed-thread]`)).toHaveCount(2);
    await expect(aboutThread).toContainText("Agent-opened");
    await expect(aboutThread).toContainText("About");
    await aboutThread
      .getByRole("button", { name: /Expand pushed thread/u })
      .click();
    await expect(
      aboutThread.getByText("You said", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(aboutThread).toContainText(
      "Keep that concern in this conversation.",
    );
  } finally {
    if (previousModel === undefined) delete process.env.BIG_PLAN_AGENT_MODEL;
    else process.env.BIG_PLAN_AGENT_MODEL = previousModel;
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should mint, continue, and settle pushes while disclosing queued reviewer work", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-live-push-mint-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const previousModel = process.env.BIG_PLAN_AGENT_MODEL;
  process.env.BIG_PLAN_AGENT_MODEL = "live-push-test-model";
  try {
    await page.goto(runtime.url);
    await writeAgentRequest({
      store: runtime.store,
      request: messageAgentRequest({
        kind: "chat",
        requestId: "1111111111111111",
        sessionId: runtime.sessionId,
        planId: runtime.planId,
        premiseSnapshot: deriveSnapshotDigest(PLAN),
        createdAt: "2026-08-21T12:00:00.000Z",
        body: "Queued reviewer question",
      }),
    });
    const opened = await runAgentCli([
      "push",
      planPath,
      "--prompt",
      "Tighten the delivery boundary",
    ]);
    expect(opened.stdout).toContain(
      "1 reviewer message is waiting; answer it next",
    );
    const openingId = agentIdOf(opened.stdout, "requestId");
    const openingThreadId = agentIdOf(opened.stdout, "threadId");
    const openingAgentToken = agentIdOf(opened.stdout, "agent_token");
    const openingConnectionToken = agentIdOf(opened.stdout, "connection_token");
    expect(openingThreadId).toBe(openingId);
    expect(
      (
        await readAgentExchange({
          store: runtime.store,
          sessionId: runtime.sessionId,
          planId: runtime.planId,
        })
      ).requests.find((request) => request.requestId === openingId),
    ).toMatchObject({
      kind: "push",
      origin: "prompt",
      body: "Tighten the delivery boundary",
      threadId: openingThreadId,
      claimGeneration: 1,
      claimedModel: { name: "live-push-test-model" },
    });
    const unintendedCandidate = PLAN.replace(
      "The terminal response publishes the candidate atomically.",
      "A non-changed push must not publish this candidate.",
    );
    await writeFile(
      candidatePlanOf(opened.stdout),
      unintendedCandidate,
      "utf8",
    );
    await writeFile(
      responseDraftOf(opened.stdout),
      JSON.stringify({
        requestId: openingId,
        outcomes: [
          {
            commentId: openingThreadId,
            state: "answered",
            message: "No plan revision was needed.",
          },
        ],
      }),
      "utf8",
    );
    const refusedEdit = await runRefusedAgentCli([
      "respond",
      planPath,
      responseDraftOf(opened.stdout),
      "--agent",
      openingAgentToken,
    ]);
    expect(`${refusedEdit.stdout}\n${refusedEdit.stderr}`).toContain(
      "outcome cannot revise the plan source",
    );
    await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);
    await expect(
      readCommittedRevision({ store: runtime.store, requestId: openingId }),
    ).resolves.toBeUndefined();
    await writeFile(candidatePlanOf(opened.stdout), PLAN, "utf8");
    await settlePushWithoutChanges({ planPath, stdout: opened.stdout });
    await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);
    await expect(
      readCommittedRevision({ store: runtime.store, requestId: openingId }),
    ).resolves.toBeUndefined();

    const continued = await runAgentCli([
      "push",
      planPath,
      "--about",
      "Also clarified the delivery wording",
      "--thread",
      openingThreadId,
      "--agent",
      openingAgentToken,
      "--connection",
      openingConnectionToken,
    ]);
    expect(agentIdOf(continued.stdout, "threadId")).toBe(openingThreadId);
    expect(continued.stdout).toContain("opened: false");
    const continuationId = agentIdOf(continued.stdout, "requestId");
    expect(
      (
        await readAgentExchange({
          store: runtime.store,
          sessionId: runtime.sessionId,
          planId: runtime.planId,
        })
      ).requests.find((request) => request.requestId === continuationId),
    ).toMatchObject({
      kind: "push",
      origin: "about",
      body: "Also clarified the delivery wording",
      threadId: openingThreadId,
    });
    const continuedCandidate = PLAN.replace(
      "The terminal response publishes the candidate atomically.",
      "The pushed response publishes the candidate atomically.",
    );
    await writeFile(
      candidatePlanOf(continued.stdout),
      continuedCandidate,
      "utf8",
    );
    await writeFile(
      responseDraftOf(continued.stdout),
      JSON.stringify({
        requestId: continuationId,
        outcomes: [
          {
            commentId: openingThreadId,
            state: "changed",
            message: "Clarified the pushed publication boundary.",
            changeTargets: ["section/delivery-boundary/paragraph-1"],
          },
        ],
      }),
      "utf8",
    );
    await runAgentCli([
      "respond",
      planPath,
      responseDraftOf(continued.stdout),
      "--agent",
      agentIdOf(continued.stdout, "agent_token"),
    ]);
    await expect(readFile(planPath, "utf8")).resolves.toBe(continuedCandidate);
    await expect(
      readCommittedRevision({
        store: runtime.store,
        requestId: continuationId,
      }),
    ).resolves.toMatchObject({ provenance: "push" });
    const unknownThread = "9999999999999999";
    const unknown = await runRefusedAgentCli([
      "push",
      planPath,
      "--about",
      "Continue a missing thread",
      "--thread",
      unknownThread,
      "--agent",
      openingAgentToken,
      "--connection",
      openingConnectionToken,
    ]);
    expect(`${unknown.stdout}\n${unknown.stderr}`).toContain(
      `No pushed thread ${unknownThread} exists on this plan`,
    );
    await writeResolvedCommentIds({
      store: runtime.store,
      ids: [openingThreadId],
    });
    const resolved = await runRefusedAgentCli([
      "push",
      planPath,
      "--about",
      "Continue a resolved thread",
      "--thread",
      openingThreadId,
      "--agent",
      openingAgentToken,
      "--connection",
      openingConnectionToken,
    ]);
    expect(`${resolved.stdout}\n${resolved.stderr}`).toContain(
      "Unresolve this thread before sending new work.",
    );
    await cancelRequest(page, "1111111111111111");
  } finally {
    if (previousModel === undefined) delete process.env.BIG_PLAN_AGENT_MODEL;
    else process.env.BIG_PLAN_AGENT_MODEL = previousModel;
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should fence live and open pushes and keep a displaced candidate private", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-live-push-fence-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const opened = await test.step("open the first push", () =>
      runAgentCli([
        "push",
        planPath,
        "--about",
        "Prepare an isolated revision",
      ]));
    const requestId = agentIdOf(opened.stdout, "requestId");
    const agentToken = agentIdOf(opened.stdout, "agent_token");
    const connectionToken = agentIdOf(opened.stdout, "connection_token");
    const candidatePath = candidatePlanOf(opened.stdout);
    const responsePath = responseDraftOf(opened.stdout);
    const privateRevision = PLAN.replace(
      "The terminal response publishes the candidate atomically.",
      "The displaced response must stay private.",
    );
    await writeFile(candidatePath, privateRevision, "utf8");

    const ownClaim = await test.step("refuse the holder's second push", () =>
      runRefusedAgentCli([
        "push",
        planPath,
        "--about",
        "Try to stack another revision",
        "--agent",
        agentToken,
      ]));
    expect(`${ownClaim.stdout}\n${ownClaim.stderr}`).toContain(
      "This agent is mid-answer on another request",
    );
    const otherClaim = await test.step("refuse another live claimant", () =>
      runRefusedAgentCli([
        "push",
        planPath,
        "--about",
        "Try from another session",
      ]));
    expect(`${otherClaim.stdout}\n${otherClaim.stderr}`).toContain(
      "PRIMACY_LOST",
    );

    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const stored = exchange.requests.find(
      (request) => request.requestId === requestId,
    );
    if (stored === undefined)
      throw new Error("The push request was not stored");
    await writeAgentRequestValue({
      store: runtime.store,
      requestId,
      value: { ...stored, claimExpiresAtMs: Date.now() - 1 },
    });
    const stacked = await test.step("refuse a second open push", () =>
      runRefusedAgentCli([
        "push",
        planPath,
        "--about",
        "Try after the first claim lapses",
        "--agent",
        agentToken,
        "--connection",
        connectionToken,
      ]));
    expect(`${stacked.stdout}\n${stacked.stderr}`).toContain(
      `This agent already holds an open push (thread ${requestId})`,
    );

    const takeoverToken = "2222222222222222";
    const takeover = await test.step("take over the lapsed push", () =>
      claimAgentRequest({
        store: runtime.store,
        activeSessionId: runtime.sessionId,
        requestId,
        claimedBy: takeoverToken,
        baselineSnapshot: deriveSnapshotDigest(PLAN),
        now: new Date().toISOString(),
      }));
    expect(takeover).toMatchObject({
      requestId,
      claimedBy: takeoverToken,
      claimGeneration: 2,
    });
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId,
        outcomes: [
          {
            commentId: requestId,
            state: "changed",
            message: "Publish the displaced revision.",
            changeTargets: ["section/delivery-boundary/paragraph-1"],
          },
        ],
      }),
      "utf8",
    );
    const displaced = await test.step("refuse the displaced response", () =>
      runRefusedAgentCli([
        "respond",
        planPath,
        responsePath,
        "--agent",
        agentToken,
      ]));
    expect(`${displaced.stdout}\n${displaced.stderr}`).toContain(
      "this claim generation can no longer publish",
    );
    await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);
    await cancelRequest(page, requestId);
    await expect(
      access(join(runtime.store.agentMutationDirectory, requestId)),
    ).rejects.toThrow();

    const released = await runAgentCli([
      "push",
      planPath,
      "--about",
      "The canceled push released the plan",
      "--agent",
      agentToken,
      "--connection",
      connectionToken,
    ]);
    await cancelRequest(page, agentIdOf(released.stdout, "requestId"));
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should refuse a push whose source moved and preserve the moving revision", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-live-push-moved-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const opened = await runAgentCli([
      "push",
      planPath,
      "--about",
      "Revise the delivery boundary",
    ]);
    const requestId = agentIdOf(opened.stdout, "requestId");
    const agentToken = agentIdOf(opened.stdout, "agent_token");
    const candidatePath = candidatePlanOf(opened.stdout);
    const responsePath = responseDraftOf(opened.stdout);
    const candidate = PLAN.replace(
      "The terminal response publishes the candidate atomically.",
      "The push response publishes the candidate atomically.",
    );
    await writeFile(candidatePath, candidate, "utf8");
    const moved = PLAN.replace(
      "The reviewer keeps reading while an agent prepares a revision.",
      "The reviewer moved the plan while the agent prepared a revision.",
    );
    await writeFile(planPath, moved, "utf8");
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId,
        outcomes: [
          {
            commentId: requestId,
            state: "changed",
            message: "Updated the delivery boundary.",
            changeTargets: ["section/delivery-boundary/paragraph-1"],
          },
        ],
      }),
      "utf8",
    );
    const refused = await runRefusedAgentCli([
      "respond",
      planPath,
      responsePath,
      "--agent",
      agentToken,
    ]);
    expect(`${refused.stdout}\n${refused.stderr}`).toContain("SOURCE_MOVED");
    await expect(readFile(planPath, "utf8")).resolves.toBe(moved);
    await cancelRequest(page, requestId);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Drives one push to its commit and hands back what the reviewer should now be
 * able to see. Both arrival journeys need the same setup and differ only in
 * what the rail was doing when it landed, so the shape is shared rather than
 * copied.
 */
const pushRevisionFrom = async ({
  planPath,
  prompt,
}: {
  readonly planPath: string;
  readonly prompt: string;
}): Promise<{ readonly threadId: string; readonly revised: string }> => {
  const opened = await runAgentCli(["push", planPath, "--prompt", prompt]);
  const requestId = agentIdOf(opened.stdout, "requestId");
  const threadId = agentIdOf(opened.stdout, "threadId");
  const agentToken = agentIdOf(opened.stdout, "agent_token");
  const connectionToken = agentIdOf(opened.stdout, "connection_token");
  const revised = PLAN.replace(
    "The reviewer keeps reading while an agent prepares a revision.",
    "The reviewer keeps reading while an agent quietly prepares a revision.",
  ).replace(
    "The terminal response publishes the candidate atomically.",
    "The terminal response publishes the arriving candidate atomically.",
  );
  await writeFile(candidatePlanOf(opened.stdout), revised, "utf8");
  await writeFile(
    responseDraftOf(opened.stdout),
    JSON.stringify({
      requestId,
      outcomes: [
        {
          commentId: threadId,
          state: "changed",
          message: "Named the arriving candidate.",
          changeTargets: [
            "document/paragraph-1",
            "section/delivery-boundary/paragraph-1",
          ],
        },
      ],
    }),
    "utf8",
  );
  await runAgentCli([
    "respond",
    planPath,
    responseDraftOf(opened.stdout),
    "--agent",
    agentToken,
    "--connection",
    connectionToken,
  ]);
  return { threadId, revised };
};

test("should open the rail, name the agent, and settle the changed blocks when a push arrives mid-read", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-live-push-arrival-"),
  );
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const previousModel = process.env.BIG_PLAN_AGENT_MODEL;
  const previousClient = process.env.BIG_PLAN_AGENT_CLIENT;
  process.env.BIG_PLAN_AGENT_MODEL = "claude-opus-5";
  process.env.BIG_PLAN_AGENT_CLIENT = "claude-code 2.1.217";

  try {
    // The rail reserves a gutter beside the reading column only on a wide
    // viewport; opening it anywhere narrower would cover the text, which is
    // why the auto-open is a wide-viewport promise and is proven as one.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(runtime.url);
    await page.evaluate(() =>
      window.scrollBy({ top: 240, behavior: "instant" }),
    );
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);
    await expect(
      page.getByRole("complementary", { name: "Feedback" }),
    ).toBeHidden();

    // Armed before the push commits, so the one-shot settle cannot finish
    // between the swap landing and the assertion being made. The mark clears
    // itself when its animation ends, so what is asserted later is this
    // record of the blocks that took it rather than the live attribute, which
    // is only true for as long as the wash is still running.
    const settled = page.waitForSelector("[data-review-settled]", {
      timeout: 20_000,
    });
    await page.evaluate(() => {
      const taken: Array<string> = [];
      Object.defineProperty(window, "settledBlockIds", { value: taken });
      new MutationObserver((records) => {
        for (const record of records) {
          const element = record.target as HTMLElement;
          const blockId = element.getAttribute("data-block-id");
          if (
            blockId === null ||
            !element.hasAttribute("data-review-settled") ||
            taken.includes(blockId)
          ) {
            continue;
          }
          taken.push(blockId);
        }
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-review-settled"],
      });
    });
    const { threadId } = await pushRevisionFrom({
      planPath,
      prompt: "Say plainly what the reviewer is about to see.",
    });

    const rail = page.getByRole("complementary", { name: "Feedback" });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    await expect(rail.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Asserted before the plan swap is awaited, because the freshness label is
    // a live clock: "just now" is what it says on sight and it ages honestly
    // from there, so pinning that one word would be pinning how long the swap
    // and the next poll happened to take. What the entry owes the reader is
    // that a push landed, who pushed it, and how much it touched.
    const entry = rail.locator("[data-review-push-arrival]");
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await expect(entry).toContainText(
      /Pushed (?:just now|\d+[sm] ago|over an hour ago)/u,
    );
    await expect(entry).toContainText("Claude Opus 5");
    await expect(entry).toContainText("Claude Code");
    await expect(entry).toContainText("2 blocks changed in the plan.");

    await expect(page.locator("article")).toContainText(
      "publishes the arriving candidate atomically",
      { timeout: 15_000 },
    );

    await expect(settled).resolves.toBeTruthy();
    // Both changed blocks are laid out in this plan, so the settle reaches
    // exactly the blocks the outcome named and nothing else.
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as SettleRecord).settledBlockIds,
        ),
      )
      .toEqual([
        "document/paragraph-1",
        "section/delivery-boundary/paragraph-1",
      ]);

    // The arrival is an offer, never a shove: neither the rail opening nor the
    // article swap may move the reader off the sentence they were on.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);

    // Opening the thread is an acknowledgement, so the entry stands down.
    await entry.getByRole("button", { name: "Open thread" }).click();
    await expect(entry).toBeHidden();
    await expect(
      rail.locator(`[data-review-pushed-thread="${threadId}"]`),
    ).toContainText("Named the arriving candidate.");
  } finally {
    if (previousModel === undefined) delete process.env.BIG_PLAN_AGENT_MODEL;
    else process.env.BIG_PLAN_AGENT_MODEL = previousModel;
    if (previousClient === undefined) delete process.env.BIG_PLAN_AGENT_CLIENT;
    else process.env.BIG_PLAN_AGENT_CLIENT = previousClient;
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should announce an arrival in an open rail without motion when the reader asked for less", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-live-push-arrival-still-"),
  );
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const previousModel = process.env.BIG_PLAN_AGENT_MODEL;
  process.env.BIG_PLAN_AGENT_MODEL = "live-push-still-model";

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail.getByRole("tab", { name: "Chat" }).click();
    await page.evaluate(() =>
      window.scrollBy({ top: 240, behavior: "instant" }),
    );
    const scrollY = await page.evaluate(() => window.scrollY);

    await pushRevisionFrom({
      planPath,
      prompt: "Arrive while the rail is already open.",
    });
    await expect(page.locator("article")).toContainText(
      "publishes the arriving candidate atomically",
      { timeout: 15_000 },
    );

    const entry = rail.locator("[data-review-push-arrival]");
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("live-push-still-model");
    // The entry leads the thread list rather than appearing beneath it.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const arrival = document.querySelector("[data-review-push-arrival]");
          const thread = document.querySelector("[data-review-pushed-thread]");
          if (arrival === null || thread === null) return "missing";
          return (arrival.compareDocumentPosition(thread) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
            0
            ? "arrival-first"
            : "thread-first";
        }),
      )
      .toBe("arrival-first");

    // A reader who asked for less motion gets no settle at all, rather than a
    // stilled one that would leave a highlight they never dismissed.
    await expect(page.locator("[data-review-settled]")).toHaveCount(0);
    await expect
      .poll(() => page.locator("[data-review-settled]").count(), {
        timeout: 3_000,
        intervals: [200, 200, 200, 200, 200],
      })
      .toBe(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);

    await entry.getByRole("button", { name: "Dismiss" }).click();
    await expect(entry).toBeHidden();
  } finally {
    if (previousModel === undefined) delete process.env.BIG_PLAN_AGENT_MODEL;
    else process.env.BIG_PLAN_AGENT_MODEL = previousModel;
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
