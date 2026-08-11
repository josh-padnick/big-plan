// Critical browser journey for the local review runtime behind the React
// commenting chrome: server-backed restoration and one real feedback handoff.

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commentsFromExchange,
  deriveSnapshotDigest,
  nextPendingAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
} from "../src/review/agent-exchange.js";
import {
  appendProgressEvent,
  claimAgentRequest,
  publishAgentResponse,
} from "../src/review/request-mailbox.js";
import { diffSnapshots } from "../src/review/snapshot-diff.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  reviewStoreFor,
  writeAgentHeartbeat,
  writeSnapshot,
} from "../src/review/store.js";
import { renderDocument } from "../src/render/render-document.js";
import { expect, stageComment, test } from "./fixtures";

test("should expire a held connected snapshot when the reviewer returns", async ({
  page,
  reviewRuntimeUrl,
}) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.goto(reviewRuntimeUrl);
  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The review runtime did not describe its live session");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "waiting",
    now,
  });
  await page.clock.runFor(1_600);
  await expect(
    page.getByRole("button", { name: "Agent session active" }),
  ).toBeVisible();

  await page.clock.setSystemTime(now + 6 * 60 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const connectionLost = page.getByRole("button", {
    name: /Agent connection lost/u,
  });
  await expect(connectionLost).toBeVisible();
  await connectionLost.click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toContainText("No agent signal for 6h 00m");
});

test("should restore and submit staged comments through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);

  const agentStatus = page.getByRole("button", {
    name: /open agent connection status/u,
  });
  const feedbackAction = page.getByRole("button", {
    name: "Feedback",
    exact: true,
  });
  const settingsAction = page.getByRole("button", { name: "Open settings" });
  await expect(agentStatus).toBeVisible();
  await expect(feedbackAction).toBeVisible();
  await expect(settingsAction).toBeVisible();
  const toolbarGaps = await Promise.all([
    agentStatus.boundingBox(),
    feedbackAction.boundingBox(),
    settingsAction.boundingBox(),
  ]).then(([status, feedback, settings]) => {
    if (status === null || feedback === null || settings === null)
      throw new Error("The review toolbar actions were not rendered");
    return [
      feedback.x - status.x - status.width,
      settings.x - feedback.x - feedback.width,
    ];
  });
  expect(toolbarGaps).toEqual([12, 12]);

  await stageComment(page, "Clarify the failure boundary.");
  await stageComment(page, "Name the operator recovery path.");
  await stageComment(page, "Remove this queued comment before pickup.");

  const rail = page.getByRole("complementary", { name: "Feedback" });
  const kernel = page.locator("#big-plan-review-root");
  await expect(rail).toHaveCount(0);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("Name the operator recovery path.");
  await expect(rail).toContainText("Remove this queued comment before pickup.");
  await expect(rail).toContainText("1 · Details");
  await expect(rail).toContainText("The agent is disconnected");

  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("Name the operator recovery path.");
  await expect(rail).toContainText("Remove this queued comment before pickup.");

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  const answer: unknown = await response.json();
  if (
    typeof answer !== "object" ||
    answer === null ||
    !("package" in answer) ||
    !("brief" in answer) ||
    typeof answer.package !== "string" ||
    typeof answer.brief !== "string"
  ) {
    throw new Error("The feedback response did not name its output files");
  }
  expect((await stat(answer.package)).isFile()).toBe(true);
  expect((await stat(answer.brief)).isFile()).toBe(true);
  expect(await readFile(answer.brief, "utf8")).toContain(
    "Clarify the failure boundary.",
  );

  await expect(rail).toContainText("3 comments sent to the agent");
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();
  const queuedForDeletion = rail
    .locator("[data-review-sent-thread='queued']")
    .filter({ hasText: "Remove this queued comment before pickup." });
  await queuedForDeletion
    .getByRole("button", { name: "Delete queued comment" })
    .click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete queued comment?",
  });
  await expect(deleteDialog).toContainText(
    "This removes the comment before the agent picks it up.",
  );
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(rail).not.toContainText(
    "Remove this queued comment before pickup.",
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const blockedSummary = page.locator(
    ".review-contextual-summary[data-review-sent-thread='queued']",
  );
  await expect(
    blockedSummary
      .getByRole("img", {
        name: "Blocked - no agent connected",
      })
      .first(),
  ).toBeVisible();
  await expect(blockedSummary.first()).toContainText("Queued");
  await expect(blockedSummary.first()).not.toContainText(
    "BLOCKED - NO AGENT CONNECTED",
  );
  await expect(
    blockedSummary.getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();

  await rail.getByRole("tab", { name: "Agent" }).click();
  await expect(rail.getByText("Current status", { exact: true })).toBeVisible();
  const currentActivity = rail.locator("[data-review-current-activity]");
  await expect(currentActivity).toHaveAttribute(
    "data-review-current-activity",
    "disconnected",
  );
  await expect(currentActivity).toContainText("The agent is disconnected");
  await expect(currentActivity).not.toContainText("1 · Details");
  await expect(
    currentActivity.getByRole("button", { name: "View thread →" }),
  ).toHaveCount(0);
  await expect(currentActivity.getByText("offline")).toHaveCSS(
    "text-transform",
    "uppercase",
  );
  const connectionLog = rail
    .getByText("Connection log", { exact: true })
    .locator("xpath=ancestor::summary");
  await expect(connectionLog.locator("svg")).toHaveCount(1);
  await connectionLog.click();
  const currentConnectionEvent = rail.locator(
    "[data-review-connection-current]",
  );
  await expect(currentConnectionEvent).toHaveCSS("line-height", "12px");
  const currentDuration = currentConnectionEvent.locator(
    "[data-review-connection-duration]",
  );
  await expect(currentDuration).toBeVisible();
  await currentDuration.evaluate((node) => {
    const values = [node.textContent ?? ""];
    const observer = new MutationObserver(() => {
      const value = node.textContent ?? "";
      if (values.at(-1) !== value) values.push(value);
    });
    observer.observe(node, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    Object.assign(window, {
      __bigPlanConnectionDurations: values,
      __bigPlanConnectionDurationObserver: observer,
    });
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __bigPlanConnectionDurations: ReadonlyArray<string>;
              }
            ).__bigPlanConnectionDurations.length,
        ),
      { timeout: 3_500 },
    )
    .toBeGreaterThanOrEqual(3);
  const durationValues = await page.evaluate(() => {
    const runtime = window as unknown as {
      __bigPlanConnectionDurations: ReadonlyArray<string>;
      __bigPlanConnectionDurationObserver: MutationObserver;
    };
    runtime.__bigPlanConnectionDurationObserver.disconnect();
    return runtime.__bigPlanConnectionDurations.slice(-3);
  });
  const durationSeconds = durationValues.map((value) => {
    const hours = Number(/(\d+)h/u.exec(value)?.[1] ?? 0);
    const minutes = Number(/(\d+)m/u.exec(value)?.[1] ?? 0);
    const seconds = Number(/(\d+)s/u.exec(value)?.[1] ?? 0);
    return hours * 3_600 + minutes * 60 + seconds;
  });
  for (let index = 1; index < durationSeconds.length; index += 1) {
    const previous = durationSeconds[index - 1] ?? 0;
    const current = durationSeconds[index] ?? 0;
    expect(current).toBeGreaterThan(previous);
    expect(current - previous).toBeLessThanOrEqual(2);
  }
  await rail.getByRole("tab", { name: "Comments" }).click();
  const selectedThread = rail
    .locator("[data-review-comment-id]")
    .filter({ hasText: "Clarify the failure boundary." });
  await selectedThread
    .getByRole("button", { name: /^Expand thread:/u })
    .click();
  const reply = selectedThread.getByPlaceholder("Reply to the agent…");
  await expect(reply).toBeVisible();
  const selectedToolbar = selectedThread.locator(".review-thread-meta");
  const restingToolbarBackground = await selectedToolbar.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  await selectedToolbar.hover();
  await expect
    .poll(() =>
      selectedToolbar.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      ),
    )
    .not.toBe(restingToolbarBackground);
  const selectedTitle = selectedToolbar.getByRole("button", {
    name: "1 · Details",
    exact: true,
  });
  await expect(selectedTitle).toHaveCSS("text-decoration-line", "none");
  await rail
    .getByRole("button", {
      name: "The agent is disconnected — view Agent tab",
    })
    .click();
  await expect(rail.getByRole("tab", { name: "Agent" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(rail.locator("[data-review-current-activity]")).toHaveAttribute(
    "data-review-attention",
    "true",
  );
  await rail.getByRole("tab", { name: "Comments" }).click();
  await expect(reply).toBeVisible();
  await selectedTitle.click();
  await expect(reply).toBeVisible();
  await selectedThread.getByRole("button", { name: "Minimize thread" }).click();
  await expect(
    selectedThread.getByRole("button", {
      name: "Expand thread: Clarify the failure boundary.",
    }),
  ).toBeVisible();

  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const sessionResponse = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return sessionResponse.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The review runtime did not describe its live session");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = nextPendingAgentRequest(exchange);
  if (request === undefined || request.kind !== "feedback") {
    throw new Error("Sending did not create a pending feedback request");
  }
  expect(request.comments).toHaveLength(2);
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
    now: Date.now() - 10_000,
  });
  await appendProgressEvent({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: request.requestId,
      atMs: Date.now(),
      stepCode: "agent-note",
      step: "Reviewing the shared feedback batch",
      state: "live",
    },
  });

  await expect(
    page.getByRole("button", { name: /Agent connection lost/u }),
  ).toHaveCount(0);
  await rail.getByRole("tab", { name: "Agent" }).click();
  const activeWork = rail.locator("[data-review-current-activity='working']");
  await expect(activeWork).toContainText("Responding to a comment");
  await expect(activeWork).toContainText("Reviewing the shared feedback batch");
  await rail.getByRole("tab", { name: "Chat" }).click();
  await rail
    .getByPlaceholder("Ask about the plan as a whole…")
    .fill("How does this affect the rollout?");
  await rail.getByRole("button", { name: "Send", exact: true }).click();
  const waitingChat = rail
    .locator("li")
    .filter({ hasText: "How does this affect the rollout?" });
  await expect(waitingChat).toContainText(
    "Waiting - the agent is working on another request",
  );
  await waitingChat
    .getByRole("button", { name: "View active comment →" })
    .click();
  const linkedActiveComment = rail
    .locator('[data-review-comment-id][data-review-selected="true"]')
    .filter({ hasText: "Clarify the failure boundary." });
  await expect(linkedActiveComment).toBeVisible();
  await linkedActiveComment
    .getByRole("button", { name: "Minimize thread" })
    .click();
  await rail.getByRole("tab", { name: "Chat" }).click();
  await waitingChat.getByRole("button", { name: "Cancel request" }).click();
  await expect(waitingChat).toContainText("Request canceled");
  await rail.getByRole("tab", { name: "Comments" }).click();

  const workingGroup = rail.locator("[data-review-thread-group='working']");
  await expect(workingGroup).toBeVisible();
  const workingCards = workingGroup.locator(
    "[data-review-sent-thread='working']",
  );
  await expect(workingCards).toHaveCount(2);
  await expect(
    workingGroup.locator("[data-review-thread-status='working']"),
  ).toHaveCount(0);
  await workingCards
    .first()
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  const threadActivity = workingCards
    .first()
    .locator("[data-review-thread-status='working']");
  await expect(threadActivity).toHaveCount(1);
  await expect(threadActivity).toContainText("Agent is working on 2 comments");
  await expect(threadActivity).toContainText(
    "Reviewing the shared feedback batch",
  );
  expect(
    await workingCards
      .first()
      .evaluate((node) => getComputedStyle(node).borderTopColor),
  ).toBe(
    await threadActivity.evaluate(
      (node) => getComputedStyle(node).borderTopColor,
    ),
  );
  await workingCards
    .first()
    .getByRole("button", { name: "Minimize thread" })
    .click();
  await rail.getByRole("tab", { name: "Agent" }).click();
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });
  await rail
    .getByText("Connection log", { exact: true })
    .locator("xpath=ancestor::summary")
    .click();
  await rail.getByRole("tab", { name: "Comments" }).click();

  await rail.getByRole("button", { name: "Close feedback" }).click();
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });
  const compactWorkingThreads = page.locator(
    "[data-review-thread-side] [data-review-sent-thread='working']",
  );
  await expect(compactWorkingThreads).toHaveCount(2);
  await expect(compactWorkingThreads.getByLabel("Working")).toHaveCount(2);
  const firstWorkingThread = compactWorkingThreads.filter({
    hasText: "Clarify the failure boundary.",
  });
  await firstWorkingThread
    .getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    })
    .click();
  await expect(firstWorkingThread).toContainText(
    "Agent is working on 2 comments",
  );
  await expect(firstWorkingThread).toContainText(
    "Reviewing the shared feedback batch",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-review-thread-side] > :first-child",
          ),
        ).filter((card) => card.getBoundingClientRect().height > 0);
        return cards.flatMap((card, index) => {
          const rect = card.getBoundingClientRect();
          return cards.slice(index + 1).flatMap((other) => {
            const otherRect = other.getBoundingClientRect();
            const overlaps =
              rect.left < otherRect.right &&
              rect.right > otherRect.left &&
              rect.top < otherRect.bottom &&
              rect.bottom > otherRect.top;
            return overlaps ? [`${index}`] : [];
          });
        });
      }),
    )
    .toEqual([]);
  await firstWorkingThread
    .getByRole("button", { name: "Minimize thread" })
    .click();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await firstWorkingThread
    .getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    })
    .click();
  await expect(rail).toBeVisible();
  await expect(firstWorkingThread).toContainText(
    "Reviewing the shared feedback batch",
  );
  await firstWorkingThread
    .getByRole("button", { name: "Minimize thread" })
    .click();

  const beforeSource = await readFile(session.plan, "utf8");
  const afterSource = beforeSource
    .replace(
      "Keep every reviewer note safe while the plan is discussed.\n\n",
      "",
    )
    .replace(
      "Sending writes one real feedback package beside this plan.",
      "Sending atomically writes one real feedback package beside this plan.",
    );
  await writeFile(session.plan, afterSource, "utf8");
  const before = renderDocument({
    markdown: beforeSource,
    fallbackTitle: "Review persistence",
    identity: {},
  });
  const after = renderDocument({
    markdown: afterSource,
    fallbackTitle: "Review persistence",
    identity: {},
  });
  const locations = diffSnapshots({
    before: before.blocks,
    after: after.blocks,
  });
  const changedBlocks = new Set(
    locations.flatMap((location) =>
      location.newBlockId === undefined ? [] : [location.newBlockId],
    ),
  );
  const changeTarget = [...changedBlocks].at(-1);
  if (changeTarget === undefined) {
    throw new Error("The simulated rewrite produced no changed target");
  }
  const resultSnapshot = deriveSnapshotDigest(afterSource);
  await writeSnapshot({
    store,
    snapshot: resultSnapshot,
    source: afterSource,
  });
  const claimed = await claimAgentRequest({
    store,
    requestId: request.requestId,
    baselineSnapshot: request.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await publishAgentResponse({
    store,
    response: validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: request.comments.map((comment) => ({
          commentId: comment.id,
          state: "changed",
          message: "Removed the ambiguous promise and tightened delivery.",
          changeTargets: [changeTarget],
        })),
      },
      request: claimed,
      commentsById: commentsFromExchange(exchange),
      changedBlocks,
      currentSnapshot: resultSnapshot,
      now: new Date().toISOString(),
    }),
  });

  await expect(kernel).toContainText("Changed");
  const sentThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: "Clarify the failure boundary." });
  await expect(sentThread.locator(".review-sent-target")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(sentThread.locator(".review-sent-target")).toHaveCSS(
    "padding-left",
    "2px",
  );
  await expect(sentThread.locator(".review-sent-target")).toHaveText(
    "1 · Details",
  );
  await expect(sentThread.locator(".review-sent-summary")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(sentThread.locator(".review-sent-metadata")).toHaveCSS(
    "border-top-width",
    "1px",
  );
  await expect(sentThread.locator(".review-sent-time")).toHaveCSS(
    "font-size",
    "11px",
  );
  const compactReviewerStyle = await sentThread
    .locator(".review-sent-summary")
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        borderRightColor: style.borderRightColor,
      };
    });
  await expect(
    sentThread.getByRole("button", { name: "Expand thread", exact: true }),
  ).toBeVisible();
  await expect(
    sentThread.getByRole("button", { name: "Revert response" }),
  ).toBeVisible();
  await expect(
    sentThread.getByRole("button", { name: "Resolve comment" }),
  ).toBeVisible();
  await sentThread
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  const expandedReviewer = sentThread
    .locator('[data-review-message="user"]')
    .first();
  await expect(expandedReviewer.locator("p")).toHaveCSS("font-size", "12px");
  expect(
    await expandedReviewer.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        borderRightColor: style.borderRightColor,
      };
    }),
  ).toEqual(compactReviewerStyle);
  await expect(kernel).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  const changedNextStepLabels = await sentThread
    .locator("[data-review-thread-next-steps] button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  expect(changedNextStepLabels).toEqual([
    "Minimize thread",
    "Revert response",
    "Resolve comment",
  ]);
  await kernel.getByRole("button", { name: /Review change/u }).click();
  await expect(page.locator("[data-review-diff-lens]")).toContainText(
    "What changed",
  );
  await expect(page.locator("[data-review-diff-stepper]")).toContainText(
    "Change 1 of",
  );
  await expect(kernel).toContainText("atomically");
  const closeReview = sentThread.getByRole("button", {
    name: "Close review",
  });
  await expect(closeReview).toBeVisible();
  await closeReview.click();
  await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
  await sentThread.getByRole("button", { name: "Review change" }).click();
  await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
  await page.getByRole("button", { name: "Show current text" }).click();
  await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
  await page.getByRole("button", { name: "Show changes" }).click();
  await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-review-diff-stepper]")).toHaveCount(0);
  const resolve = sentThread
    .getByRole("button", { name: "Resolve comment" })
    .first();
  const restingResolveBackground = await resolve.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  await resolve.hover();
  await expect
    .poll(() =>
      resolve.evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .not.toBe(restingResolveBackground);
  await expect(resolve).toHaveCSS("color", "rgb(22, 101, 52)");
  await sentThread
    .getByRole("button", { name: "Minimize thread" })
    .first()
    .click();

  await rail.getByRole("button", { name: "Close feedback" }).click();
  const contextualThread = page
    .locator("[data-review-thread-side] [data-review-sent-thread]")
    .filter({ hasText: "Clarify the failure boundary." });
  await expect(contextualThread).toContainText("Ready for review");
  await expect(contextualThread).toContainText("Clarify the failure boundary.");
  await expect(contextualThread.locator(".review-sent-target")).toHaveCount(0);
  const contextualActions = contextualThread.locator(":scope > div");
  await expect(contextualActions).toHaveCSS("opacity", "0");
  await contextualThread.hover();
  await expect(contextualThread).toHaveAttribute(
    "data-review-associated",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-review-selection-active",
    "",
  );
  await expect(page.locator("[data-slide]").first()).not.toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await expect(contextualActions).toHaveCSS("opacity", "1");
  await contextualThread
    .getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    })
    .click();
  await expect
    .poll(() =>
      contextualThread.evaluate((card) => {
        const toolbar = card.querySelector(".review-thread-meta");
        if (!(toolbar instanceof HTMLElement)) return null;
        const cardRect = card.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        return {
          left: Math.round(toolbarRect.left - cardRect.left),
          right: Math.round(cardRect.right - toolbarRect.right),
          top: Math.round(toolbarRect.top - cardRect.top),
        };
      }),
    )
    .toEqual({ left: 1, right: 1, top: 1 });
  await contextualThread
    .getByRole("button", { name: "1 · Details", exact: true })
    .evaluate((button) => button.click());
  await expect(page.locator("html")).toHaveAttribute(
    "data-review-selection-active",
    "",
  );
  await expect(page.locator("[data-slide]").first()).not.toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await contextualThread
    .getByRole("button", { name: "Resolve comment" })
    .first()
    .click();
  await expect(
    page.locator("[data-review-thread-side] [data-review-sent-thread]"),
  ).toHaveCount(1);

  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(rail).toContainText("1 · Details");
  await expect(rail).not.toContainText(
    "Original target unavailable in this revision.",
  );

  const continuedThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: "Name the operator recovery path." });
  await continuedThread
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  const continuedReply = continuedThread.getByPlaceholder(
    "Reply to the agent…",
  );
  await continuedReply.fill("Keep the recovery steps concise.");
  const replyButton = continuedThread.getByRole("button", { name: "Reply" });
  await replyButton.hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: /Reply ·/u }),
  ).toBeVisible();
  await replyButton.click();
  await continuedThread.getByRole("button", { name: "Cancel request" }).click();
  await expect(continuedThread).toContainText("Request canceled");
  await rail.getByRole("button", { name: "Close feedback" }).click();
  const canceledInline = page
    .locator("[data-review-thread-side] [data-review-sent-thread]")
    .filter({ hasText: "Name the operator recovery path." });
  await canceledInline
    .getByRole("button", { name: "1 · Details", exact: true })
    .click();
  await expect(
    canceledInline.getByRole("button", {
      name: "Expand comment: Name the operator recovery path.",
    }),
  ).toBeVisible();
  await canceledInline
    .getByRole("button", {
      name: "Expand comment: Name the operator recovery path.",
    })
    .click();
  await expect(
    canceledInline.getByRole("button", { name: "Delete canceled comment" }),
  ).toHaveCount(0);
  await expect(canceledInline).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  await stageComment(page, "Keep this draft while the runtime is offline.");
  await page.route("**/api/agent", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "not-json",
    }),
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(
    rail.getByText("The review server is unreachable", { exact: true }),
  ).toBeVisible({ timeout: 6_000 });
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();
  await expect(
    rail.getByRole("img", { name: "The review server is unreachable" }),
  ).toBeVisible();
  await expect(rail).not.toContainText(
    "Connected to the local review runtime.",
  );
  await page.unroute("**/api/agent");
  const revertResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/revert-agent-changes") &&
      response.request().method() === "POST",
  );
  await continuedThread
    .getByRole("button", { name: "Revert response" })
    .click();
  const revertDialog = page.getByRole("alertdialog", {
    name: "Revert response?",
  });
  await expect(revertDialog).toContainText(
    "The comment and thread will remain until you delete them.",
  );
  await revertDialog.getByRole("button", { name: "Revert response" }).click();
  expect((await revertResponse).status()).toBe(200);
  await page.waitForLoadState("domcontentloaded");
  expect(await readFile(session.plan, "utf8")).toBe(beforeSource);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const revertedThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: "Name the operator recovery path." });
  await revertedThread.getByRole("button", { name: "Delete comment" }).click();
  const revertedDeleteDialog = page.getByRole("alertdialog", {
    name: "Delete comment?",
  });
  await expect(revertedDeleteDialog).toContainText(
    "The reverted plan changes stay reverted.",
  );
  await revertedDeleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(rail).not.toContainText("Name the operator recovery path.");
});

test("should preview stale, historical, and multi-place causal diffs through the real pipeline", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-diff-preview-"));
  const planPath = join(directory, "gallery.mdx");
  const before = await readFile(
    new URL("../examples/diff-gallery-before.mdx", import.meta.url),
    "utf8",
  );
  const after = (
    await readFile(
      new URL("../examples/diff-gallery-after.mdx", import.meta.url),
      "utf8",
    )
  )
    .replace(
      '<Callout type="note" title="Review note">\n\nVerify the causal boundary, the in-place lens, and the historical state.\n\n</Callout>',
      "> **Review note:** verify the causal boundary, the in-place lens, and the historical state.",
    )
    .split("\n<QuickSummary>")[0];
  await writeFile(planPath, after);
  const runtime = await startReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.waitForFunction(
      () => typeof window.bigPlan?.feedback?.add === "function",
    );
    const codeFigure = page.locator(".code-figure").last();
    await expect(
      codeFigure.getByRole("button", { name: /Comment on/u }),
    ).toBeVisible();
    await expect(codeFigure.locator("[data-review-toolbar-host]")).toHaveCSS(
      "opacity",
      "1",
    );
    const codeChrome = await codeFigure.evaluate((figure) => {
      const body = figure.querySelector(":scope > pre");
      const controls = Array.from(
        figure.querySelectorAll<HTMLElement>(
          ".figure-control, .review-toolbar-comment",
        ),
      );
      if (!(body instanceof HTMLElement) || controls.length !== 3) {
        throw new Error("The causal preview code chrome was not rendered");
      }
      const bodyRect = body.getBoundingClientRect();
      const controlRects = controls.map((control) =>
        control.getBoundingClientRect(),
      );
      return {
        bodyRight: bodyRect.right,
        controlsRight: Math.max(...controlRects.map((rect) => rect.right)),
        controlRows: new Set(controlRects.map((rect) => Math.round(rect.top)))
          .size,
        labels: controls.map((control) => control.getAttribute("aria-label")),
        gaps: controlRects
          .slice(1)
          .map((rect, index) =>
            Math.round(rect.left - (controlRects[index]?.right ?? rect.left)),
          ),
      };
    });
    expect
      .soft(codeChrome.controlsRight)
      .toBeLessThanOrEqual(codeChrome.bodyRight);
    expect.soft(codeChrome.controlRows).toBe(1);
    expect(codeChrome.labels).toEqual([
      "Copy code",
      expect.stringMatching(/^Comment on /u),
      "Maximize code",
    ]);
    expect(codeChrome.gaps).toEqual([4, 4]);
    await expect(page.locator("[data-review-diff-preview]")).toHaveCount(0);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await expect(rail).toContainText("Current diff available");
    await expect(rail).toContainText(
      "This compares the plan when you commented with the current plan.",
    );
    const originalPresentation = await page
      .locator("article > p[data-authored-prose]")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          color: style.color,
          borderBottomWidth: style.borderBottomWidth,
        };
      });
    const anchoredThread = page
      .locator("[data-review-thread-side] [data-review-sent-thread]")
      .first();
    await expect(anchoredThread).toBeVisible();
    await page.waitForTimeout(250);
    const threadPositionBeforeDiff = await anchoredThread.evaluate((thread) => {
      const rect = thread.parentElement?.getBoundingClientRect();
      if (rect === undefined)
        throw new Error("The side thread host is missing");
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    });
    await rail
      .getByRole("button", { name: "Review premise → current" })
      .click();
    await expect(page.locator("[data-review-diff-lens]")).toContainText(
      "What changed",
    );
    await page
      .getByRole("button", { name: "Mark this change reviewed" })
      .click();
    const reviewedChange = rail.locator("[data-review-changes-reviewed]");
    await expect(reviewedChange).toContainText("Review complete");
    await expect(
      reviewedChange.getByRole("button", { name: "Resolve" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mark this change unreviewed" })
      .click();
    await expect(reviewedChange).toHaveCount(0);
    await page
      .getByRole("button", { name: "Mark this change reviewed" })
      .click();
    const diffLens = page.locator("[data-review-diff-lens]");
    await expect(diffLens.locator("ins")).toHaveCSS(
      "background-color",
      "rgb(222, 234, 215)",
    );
    const diffPresentation = diffLens.locator(
      '[data-review-diff-presentation="lede"]',
    );
    await expect(diffPresentation).toHaveCSS(
      "font-size",
      originalPresentation.fontSize,
    );
    await expect(diffPresentation).toHaveCSS(
      "line-height",
      originalPresentation.lineHeight,
    );
    await expect(diffPresentation).toHaveCSS(
      "color",
      originalPresentation.color,
    );
    await expect(diffPresentation).toHaveCSS(
      "border-bottom-width",
      originalPresentation.borderBottomWidth,
    );
    const readingWidths = await page.evaluate(() => {
      const lens = document.querySelector<HTMLElement>(
        "[data-review-diff-lens]",
      );
      const prose = Array.from(
        document.querySelectorAll<HTMLElement>("p[data-authored-prose]"),
      ).find((paragraph) => getComputedStyle(paragraph).display !== "none");
      if (lens === null || prose === undefined) {
        throw new Error("The diff lens and standard prose must both render");
      }
      return {
        lensWidth: Math.round(lens.getBoundingClientRect().width),
        lensMaxWidth: Math.round(
          Number.parseFloat(getComputedStyle(lens).maxWidth),
        ),
        proseMaxWidth: Math.round(
          Number.parseFloat(getComputedStyle(prose).maxWidth),
        ),
      };
    });
    expect(readingWidths.lensWidth).toBeLessThanOrEqual(
      readingWidths.lensMaxWidth,
    );
    expect(readingWidths.lensMaxWidth).toBe(readingWidths.proseMaxWidth);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const lens = document.querySelector<HTMLElement>(
            "[data-review-diff-lens]",
          );
          if (lens === null) return ["missing diff lens"];
          const lensRect = lens.getBoundingClientRect();
          return Array.from(
            document.querySelectorAll<HTMLElement>("[data-review-thread-for]"),
          ).flatMap((thread) => {
            const threadRect = thread.getBoundingClientRect();
            const overlaps =
              threadRect.left < lensRect.right &&
              threadRect.right > lensRect.left &&
              threadRect.top < lensRect.bottom &&
              threadRect.bottom > lensRect.top;
            return overlaps
              ? [
                  {
                    thread: thread.dataset.reviewThreadFor ?? "thread",
                    lens: {
                      left: Math.round(lensRect.left),
                      right: Math.round(lensRect.right),
                      top: Math.round(lensRect.top),
                      bottom: Math.round(lensRect.bottom),
                    },
                    card: {
                      left: Math.round(threadRect.left),
                      right: Math.round(threadRect.right),
                      top: Math.round(threadRect.top),
                      bottom: Math.round(threadRect.bottom),
                    },
                  },
                ]
              : [];
          });
        }),
      )
      .toEqual([]);
    await expect
      .poll(() =>
        anchoredThread.evaluate((thread) => {
          const rect = thread.parentElement?.getBoundingClientRect();
          if (rect === undefined)
            throw new Error("The side thread host is missing");
          return { left: Math.round(rect.left), top: Math.round(rect.top) };
        }),
      )
      .toEqual(threadPositionBeforeDiff);
    await reviewedChange.getByRole("button", { name: "Resolve" }).click();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(page.locator("[data-review-diff-stepper]")).toHaveCount(0);
    await rail.getByText("Resolved (1)").click();
    await rail.getByRole("button", { name: "Unresolve", exact: true }).click();

    await rail.getByRole("tab", { name: "Chat" }).click();
    const planWideDigest = rail.getByRole("button", {
      name: /\d+ changes across \d+ slides/u,
    });
    await expect(planWideDigest).toBeVisible();
    await planWideDigest.click();
    const deliverySection = rail
      .locator("[data-review-diff-section]")
      .filter({ hasText: "2 / Delivery contract" });
    await expect(deliverySection).toBeVisible();
    await expect(deliverySection.locator("svg")).toHaveCount(0);
    await rail.getByRole("button", { name: "Review change" }).click();
    const historicalChange = page
      .locator("main")
      .getByRole("region", { name: "Historical change" });
    await expect(historicalChange).toContainText("Retired experiment");
    await expect(
      rail.getByRole("region", { name: "Historical change" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("historical-change.png"),
    });
    await page.keyboard.press("Escape");

    const planWideChangeCount = Number.parseInt(
      (await planWideDigest.textContent()) ?? "0",
      10,
    );
    await rail
      .getByRole("button", { name: /Review changes \(\d+\)|Continue review/u })
      .click();
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      `Change 1 of ${planWideChangeCount}`,
    );
    await page.getByRole("button", { name: "Next change" }).click();
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      `Change 2 of ${planWideChangeCount}`,
    );
    const diffStepper = page.locator("[data-review-diff-stepper]");
    for (let index = 2; index < planWideChangeCount; index += 1) {
      if ((await diffStepper.textContent())?.includes("Delivery contract"))
        break;
      await page.getByRole("button", { name: "Next change" }).click();
    }
    await expect(diffStepper).toContainText("Delivery contract");
    const tableDiffLens = page.locator("[data-review-diff-lens]");
    await expect(tableDiffLens.locator("[data-review-diff-table]")).toHaveCount(
      2,
    );
    const tableDiffStructure = await tableDiffLens.evaluate((lens) => {
      const tables = Array.from(
        lens.querySelectorAll<HTMLElement>("[data-review-diff-table]"),
      );
      return {
        height: Math.round(lens.getBoundingClientRect().height),
        headerCount: (lens.textContent?.match(/Where reviewers see it/gu) ?? [])
          .length,
        overflowingTables: tables.filter(
          (table) => table.scrollWidth > table.clientWidth,
        ).length,
      };
    });
    expect(tableDiffStructure.height).toBeLessThan(1_000);
    expect(tableDiffStructure.headerCount).toBe(1);
    expect(tableDiffStructure.overflowingTables).toBe(0);
    await expect(tableDiffLens).toContainText("Baseline to result");
    await expect(tableDiffLens).toContainText("Premise to current");
    await page.keyboard.press("Escape");
    await rail.getByRole("tab", { name: "Comments" }).click();
    await rail.getByRole("button", { name: "Mark addressed" }).click();
    await expect(rail.getByText("Resolved (1)")).toBeVisible();
    await rail.getByText("Resolved (1)").click();
    await expect(
      rail.getByRole("button", { name: "Unresolve comment" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expect(rail.getByText("Resolved (1)")).toBeVisible();
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should turn diagram notes and decision proposals into review comments", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  await page.waitForFunction(
    () => typeof window.bigPlan?.feedback?.add === "function",
  );
  await page.evaluate(() =>
    window.bigPlan?.feedback?.add({
      source: "flow-diagram",
      anchor: null,
      items: [{ kind: "comment", body: "Keep this source label explicit." }],
    }),
  );
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toContainText("Diagram feedback:");
  await expect(rail).toContainText("Keep this source label explicit.");

  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await page.evaluate(() =>
    window.bigPlan?.feedback?.add({
      source: "decision",
      anchor: null,
      submit: "now",
      items: [
        { kind: "comment", body: "Suggest another option: local journal." },
      ],
    }),
  );
  expect((await sent).ok()).toBe(true);
  await expect(rail).toContainText("Suggested decision option:");
  await expect(rail).toContainText("Suggest another option: local journal.");
});

test("should mark a superseded review as read-only and link to its replacement", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const session = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("plan" in session) ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The review runtime did not identify its plan");
  }
  const replacement = await startReviewRuntime({ planPath: session.plan });
  try {
    const readOnly = page.getByRole("button", {
      name: /Using read-only session/,
    });
    await expect(readOnly).toBeVisible();
    await readOnly.click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await expect(rail.getByRole("tab", { name: "Agent" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(rail).toContainText("This review was replaced");
    await expect(
      rail.getByRole("link", { name: "Open latest review" }),
    ).toHaveAttribute("href", replacement.url);
  } finally {
    await replacement.close();
  }
});
