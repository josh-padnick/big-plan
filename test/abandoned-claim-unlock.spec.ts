// One reviewer journey for a claim that outlived its agent: while the pickup
// still means something the comment stays the agent's, and once the claim is
// proven abandoned the delete affordance comes back saying why (BIG-120).

import { readAgentExchange } from "../src/review/agent-exchange.js";
import { claimAgentRequest } from "../src/review/request-mailbox.js";
import {
  reviewStoreFor,
  writeAgentHeartbeat,
  writeAgentRequestValue,
} from "../src/review/store.js";
import { AGENT_CLAIM_LEASE_MS } from "../src/review/shared/agent-claim.js";
import { AGENT_RECOVERY_HORIZON_MS } from "../src/review/shared/agent-timing.js";
import {
  expect,
  stageComment,
  test,
  type Locator,
  type Page,
} from "./fixtures";

const agentSessionId = "bbbb1111bbbb1111";
const COMMENT_BODY = "Name the recovery owner for the retry boundary.";

/** Opens one sent thread's card, which the rail may already have open. */
const expandThread = async (thread: Locator): Promise<void> => {
  const expand = thread.getByRole("button", { name: /^Expand .* comment:/u });
  if ((await expand.count()) > 0) await expand.click();
};

/** The live review session this page is reading, as the runtime reports it. */
const liveReviewSession = async (
  page: Page,
): Promise<{
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
}> => {
  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("api/session", {
      headers: { "x-big-plan-review-token": root.dataset.reviewToken ?? "" },
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
    throw new Error("The journey requires a live review session");
  }
  return {
    sessionId: session.sessionId,
    planId: session.planId,
    plan: session.plan,
  };
};

test("should hand a comment back once its claim is proven abandoned", async ({
  page,
  reviewRuntimeUrl,
}) => {
  test.setTimeout(90_000);
  await page.goto(reviewRuntimeUrl);
  await stageComment(page, COMMENT_BODY);
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

  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = exchange.requests.find(
    (candidate) => candidate.kind === "feedback",
  );
  if (request === undefined) {
    throw new Error("The journey did not create feedback work to claim");
  }
  const claimed = await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: request.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
  });

  // A live claim keeps the comment exactly as locked as it has always been.
  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const thread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: COMMENT_BODY })
    .first();
  await expandThread(thread);
  await expect(thread).toHaveAttribute("data-review-sent-thread", "working");
  await expect(
    rail.getByRole("button", { name: /^Delete .*comment/u }),
  ).toHaveCount(0);
  await expect(
    rail.locator("[data-review-abandoned-claim-unlock]"),
  ).toHaveCount(0);

  // The agent dies: nothing is attached, and the claim's own last signal ages
  // past the horizon where a pickup still explains the silence.
  const abandonedAtMs = Date.now() - AGENT_RECOVERY_HORIZON_MS - 60_000;
  await writeAgentRequestValue({
    store,
    requestId: request.requestId,
    value: {
      ...claimed,
      claimExpiresAtMs: abandonedAtMs + AGENT_CLAIM_LEASE_MS,
    },
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    now: abandonedAtMs,
  });

  const unlockNote = rail.locator("[data-review-abandoned-claim-unlock]");
  // The note appears only once a load's own reads see the aged claim and the
  // absent heartbeat, so retry the whole reopen instead of waiting longer on
  // one reload that may have raced them.
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expandThread(
      rail
        .locator("[data-review-sent-thread]")
        .filter({ hasText: COMMENT_BODY })
        .first(),
    );
    await expect(unlockNote).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 45_000 });
  await expect(unlockNote).toContainText(
    "reported nothing for far longer than a turn takes",
  );
  await expect(unlockNote).toContainText("You can delete this comment again.");
  await expect(unlockNote).toContainText(
    "its answer will no longer be accepted",
  );
  const deleteButton = rail.getByRole("button", {
    name: "Delete comment - the agent that picked it up stopped reporting",
  });
  await expect(deleteButton).toBeVisible();

  const deleted = page.waitForResponse((response) =>
    response.url().endsWith("/api/comments-delete"),
  );
  await deleteButton.click();
  const dialog = page.getByRole("alertdialog", {
    name: "Delete comment the agent left?",
  });
  await expect(dialog).toContainText(
    "reported nothing for far longer than a turn takes",
  );
  await expect(dialog).toContainText(
    "This permanently removes the comment and its thread.",
  );
  await dialog.getByRole("button", { name: "Delete" }).click();
  // The offering and the refusal are one rule, so what the reviewer was just
  // offered cannot come back a 409.
  expect((await deleted).status()).toBe(200);
  await expect(rail).not.toContainText(COMMENT_BODY);
});
