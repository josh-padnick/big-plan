// Critical browser journey for the local review runtime behind the React
// commenting chrome: server-backed restoration and one real feedback handoff.

import { readFile, stat, writeFile } from "node:fs/promises";
import {
  commentsFromExchange,
  deriveSourceRevision,
  nextPendingAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentResponse,
} from "../src/review/agent-exchange.js";
import { diffRevisions } from "../src/review/revision-diff.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  appendProgress,
  reviewStoreFor,
  writeAgentHeartbeat,
  writeRevisionSnapshot,
} from "../src/review/store.js";
import { renderDocument } from "../src/render/render-document.js";
import { expect, stageComment, test } from "./fixtures";

test("should restore and submit staged comments through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);

  await stageComment(page, "Clarify the failure boundary.");
  await stageComment(page, "Name the operator recovery path.");
  await stageComment(page, "Remove this queued comment before pickup.");

  const rail = page.getByRole("complementary", { name: "Feedback" });
  const kernel = page.locator("#big-plan-review-root");
  await expect(rail).toHaveCount(0);
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("Name the operator recovery path.");
  await expect(rail).toContainText("Remove this queued comment before pickup.");
  await expect(rail).toContainText("1 · Details");
  await expect(rail).toContainText("Comment staged locally.");

  await page.reload();
  await page.getByRole("button", { name: /Feedback/ }).click();
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

  await expect(rail).toContainText("3 comments submitted.");
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
  await expect(rail).toContainText("Queued comment deleted.");
  await page.getByRole("button", { name: /Feedback/ }).click();
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
  await expect(blockedSummary.first()).not.toContainText(
    "BLOCKED - NO AGENT CONNECTED",
  );
  await expect(
    blockedSummary.getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Feedback/ }).click();

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
  const currentDuration = rail.locator(
    "[data-review-connection-current] [data-review-connection-duration]",
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
      name: "Blocked - no agent connected — view Agent tab",
    })
    .click();
  await expect(rail.getByRole("tab", { name: "Agent" })).toHaveAttribute(
    "aria-selected",
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
  await appendProgress({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: request.requestId,
      atMs: Date.now(),
      seq: 10,
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
  await firstWorkingThread
    .getByRole("button", { name: "Minimize thread" })
    .click();
  await page.getByRole("button", { name: /Feedback/ }).click();
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
  const locations = diffRevisions({
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
  const revision = deriveSourceRevision(afterSource);
  await writeRevisionSnapshot({
    store,
    revision,
    source: afterSource,
  });
  await writeAgentResponse({
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
      request,
      commentsById: commentsFromExchange(exchange),
      changedBlocks,
      currentRevision: revision,
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
  await expect(sentThread.locator(".review-sent-summary")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(
    sentThread.getByRole("button", { name: "Expand thread", exact: true }),
  ).toBeVisible();
  await expect(
    sentThread.getByRole("button", { name: "Revert agent changes" }),
  ).toBeVisible();
  await expect(
    sentThread.getByRole("button", { name: "Resolve comment" }),
  ).toBeVisible();
  await sentThread
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  await expect(kernel).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  await expect(kernel).toContainText("A revised plan is ready.");
  await kernel.getByRole("button", { name: "See changes" }).click();
  await expect(kernel).toContainText("atomically");
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
  await expect(contextualThread).toContainText("CHANGED");
  await expect(contextualThread).toContainText("Clarify the failure boundary.");
  await expect(contextualThread.locator(".review-sent-target")).toHaveCount(0);
  const contextualActions = contextualThread.locator(":scope > div");
  await expect(contextualActions).toHaveCSS("opacity", "0");
  await contextualThread.hover();
  await expect(contextualThread).toHaveAttribute(
    "data-review-associated",
    "true",
  );
  await expect(page.locator("[data-slide]").first()).toHaveAttribute(
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
  await expect(page.locator("[data-slide]").first()).toHaveAttribute(
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
  await page.getByRole("button", { name: /Feedback/ }).click();
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
  await writeFile(session.plan, beforeSource, "utf8");
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
