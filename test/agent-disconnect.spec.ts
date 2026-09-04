// BIG-190. The journey that proves a reviewer can take an agent off a review
// without killing it. Nothing below this rung can express it: the decision
// starts in the sidebar, crosses the review runtime, is answered by a real
// `big-plan agent` process at its next command, comes back as a reported end in
// the connection log, and has to leave the review free for the next agent.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nextPendingAgentRequest,
  readAgentExchange,
} from "../src/review/agent-exchange.js";
import { claimAgentRequest } from "../src/review/request-mailbox.js";
import { AGENT_STALL_MS } from "../src/review/shared/agent-timing.js";
import {
  agentIdOf,
  agentSidebar,
  agentStatusTrigger,
  closeReviewRuntime,
  expect,
  runAgentCli,
  runRefusedAgentCli,
  startReviewRuntime,
  test,
  type Page,
} from "./fixtures";

const binPath = fileURLToPath(new URL("../bin/big-plan.mjs", import.meta.url));

const PLAN = "# Disconnect\n\nThe review has one plan-wide question open.\n";

const QUESTION = "Why does the plan start with the status quo?";

const DISCONNECT_HELP =
  "Tell the agent to end its session so a different agent can become the primary. Work in flight is dropped; your comments stay.";

/** Asks the plan-wide question that gives the next agent something to claim. */
const askPlanWideQuestion = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /Feedback/u }).click();
  const feedback = page.getByRole("complementary", { name: "Feedback" });
  await feedback.getByRole("tab", { name: "Chat" }).click();
  await feedback
    .getByPlaceholder("Ask about the plan as a whole…")
    .fill(QUESTION);
  await feedback.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
};

test("should disconnect a working agent and free the review for the next one", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-disconnect-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await askPlanWideQuestion(page);

    // A real agent session picks the question up and is holding it.
    const claim = await runAgentCli(["next", planPath, "--wait"]);
    const agentToken = agentIdOf(claim.stdout, "agent_token");
    const connectionToken = agentIdOf(claim.stdout, "connection_token");

    await agentStatusTrigger(page).click();
    const sidebar = agentSidebar(page);
    const activity = sidebar.locator("[data-review-current-activity]");
    await expect(activity).toHaveAttribute(
      "data-review-current-activity",
      "working",
      { timeout: 15_000 },
    );

    // The control the reviewer acts through, and the mark that answers what it
    // costs before they do.
    const disconnect = sidebar.locator("[data-review-agent-disconnect]");
    await expect(disconnect).toHaveText("Disconnect agent");
    const help = sidebar.getByRole("button", {
      name: "About disconnecting the agent",
    });
    await help.hover();
    const tooltip = page.getByRole("tooltip");
    // Quiet: it waits out the show delay rather than firing at a pointer that
    // is only crossing the card on its way somewhere else (BIG-184).
    await expect(tooltip).toHaveCount(0, { timeout: 250 });
    await expect(tooltip).toHaveText(DISCONNECT_HELP, { timeout: 5_000 });
    // The mark names its own explanation, so a reader who never hovers still
    // gets it.
    expect(await help.getAttribute("aria-describedby")).toBe(
      await tooltip.getAttribute("id"),
    );
    await page.screenshot({
      path: testInfo.outputPath("disconnect-tooltip.png"),
    });
    // It gets out of the way as soon as the pointer leaves, and it answers the
    // keyboard on the same terms it answers the pointer.
    await page.mouse.move(10, 400);
    await expect(tooltip).toHaveCount(0, { timeout: 5_000 });
    await help.focus();
    await expect(tooltip).toHaveText(DISCONNECT_HELP, { timeout: 5_000 });
    await help.blur();
    await expect(tooltip).toHaveCount(0, { timeout: 5_000 });

    // One dialog, and it states the part that depends on what the agent is
    // doing right now: this one is mid-answer, so the answer is dropped.
    await disconnect.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Disconnect this agent?");
    await expect(dialog).toContainText(
      "the answer it has in flight is dropped rather than delivered",
    );
    await page.screenshot({
      path: testInfo.outputPath("disconnect-confirm.png"),
    });
    await dialog.getByRole("button", { name: "Disconnect agent" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // The agent is told, not dropped: the commands it would run next answer the
    // reviewer's decision instead of carrying on.
    const refusedNote = await runRefusedAgentCli([
      "note",
      planPath,
      "Still drafting the answer",
      "--agent",
      agentToken,
      "--connection",
      connectionToken,
    ]);
    expect(`${refusedNote.stdout}${refusedNote.stderr}`).toContain(
      "AGENT_DISCONNECTED",
    );
    const ending = await runAgentCli([
      "next",
      planPath,
      "--agent",
      agentToken,
      "--connection",
      connectionToken,
    ]);
    expect(ending.stdout).toContain("disconnected: true");
    expect(ending.stdout).toContain("ended: true");

    // The log records an end somebody asked for, and says who asked (BIG-156).
    await sidebar
      .getByText("Connection log", { exact: true })
      .locator("xpath=ancestor::summary")
      .click();
    const history = sidebar.locator("[data-review-connection-history]");
    const endedRow = history.locator('[data-review-connection-event="ended"]');
    await expect(endedRow).toHaveCount(1, { timeout: 20_000 });
    await expect(endedRow).toContainText("Session ended");
    await expect(endedRow).toContainText("The reviewer disconnected the agent");
    // The departure is the log's last word, and it is an end rather than a gap
    // Big Plan had to infer from silence.
    const sequence = await history
      .locator("[data-review-connection-event]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-review-connection-event")),
      );
    // Newest first: the connection this agent made, and the end the reviewer
    // asked for, with no inferred gap between them.
    expect(sequence.slice(0, 2)).toEqual(["ended", "connected"]);
    await history.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("disconnect-connection-log.png"),
    });

    // A healthy-page disconnect frees the seat without making the review
    // unusable: the card names the departure, connection guidance remains,
    // and the ordinary review controls stay live for the next agent.
    await expect(activity).toHaveAttribute(
      "data-review-current-activity",
      "disconnected",
    );
    await expect(activity).toContainText("Agent disconnected");
    await expect(
      sidebar.getByText("Reconnect your agent", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }),
    ).toBeEnabled();

    // The question the first agent was holding is back in the queue for
    // whoever attaches next.
    const second = await runAgentCli(["next", planPath, "--wait"]);
    expect(agentIdOf(second.stdout, "connection_token")).not.toBe(
      connectionToken,
    );
    expect(second.stdout).toContain(QUESTION);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should disconnect a waiting agent without the dropped-work warning", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-quiet-off-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  // A real agent session that is attached and holding nothing: it is waiting
  // for the reviewer's next message, which is where an agent spends most of a
  // review. Disconnecting it costs nothing, and the dialog must not pretend it
  // does.
  const waiting = spawn(
    process.execPath,
    [binPath, "agent", "next", planPath, "--wait"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let waitingOutput = "";
  waiting.stdout.setEncoding("utf8");
  waiting.stdout.on("data", (chunk: string) => {
    waitingOutput += chunk;
  });
  const waitingEnded = new Promise<number | null>((settle) => {
    waiting.once("close", settle);
  });
  try {
    await page.goto(runtime.url);
    await agentStatusTrigger(page).click();
    const sidebar = agentSidebar(page);
    const disconnect = sidebar.locator("[data-review-agent-disconnect]");
    await expect(disconnect).toBeVisible({ timeout: 20_000 });

    await disconnect.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "The agent is told to end its session, and the review is free for a different agent to connect.",
    );
    await expect(dialog).not.toContainText("dropped rather than delivered");
    await page.screenshot({
      path: testInfo.outputPath("disconnect-confirm-quiet.png"),
    });
    await dialog.getByRole("button", { name: "Disconnect agent" }).click();

    // The waiting loop hears the decision on its own next pass and stops,
    // reporting the end rather than being killed.
    expect(await waitingEnded).toBe(0);
    expect(waitingOutput).toContain("disconnected: true");
  } finally {
    waiting.kill("SIGTERM");
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should offer to copy a stalled agent's session address (BIG-281)", async ({
  page,
}) => {
  /*
  The card states the session an agent is answering from in every state it can
  be in, and a reviewer copies it to paste into the tool it belongs to. A
  connector that declares a URL rather than an opaque handle is the common case,
  and it used to leave the fact row with nothing to copy - the copy control only
  ever handed over a bare handle (BIG-281). The stalled state is where the
  captain caught it: the agent is present, the session is stated, and there was
  no way to lift it.

  This runs over an INSECURE origin, where `navigator.clipboard` is undefined -
  a proxied tailnet http origin is the case the captain read the review on, and
  where the copy first silently did nothing and never confirmed. The control
  must fall back to the document copy command and still show its checkmark.
  */
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    // Simulate the insecure origin: no async clipboard at all. The control's
    // fallback selects an offscreen textarea and runs the document copy command,
    // which we capture from the element it focuses.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = (command: string): boolean => {
      if (command !== "copy") return false;
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement) {
        (
          window as typeof window & { __bigPlanCopiedCode?: string }
        ).__bigPlanCopiedCode = active.value;
        return true;
      }
      return false;
    };
  });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-stalled-copy-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const claimant = "cccccccccccccccc";
  const sessionUrl = "https://claude.ai/code/session_018yMaCopyBig281bf1a";
  // The bare session id the URL carries - what the control copies, never the URL.
  const bareSessionId = "session_018yMaCopyBig281bf1a";
  const pendingQuestion = async () =>
    nextPendingAgentRequest(
      await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
      { claimedBy: claimant, nowMs: Date.now() },
    );
  try {
    await page.goto(runtime.url);
    await askPlanWideQuestion(page);
    await expect.poll(pendingQuestion, { timeout: 20_000 }).toBeDefined();
    const pending = await pendingQuestion();
    if (pending === undefined) throw new Error("The question was not stored");

    const stalledAtMs = Date.now() - AGENT_STALL_MS - 5_000;
    await claimAgentRequest({
      store: runtime.store,
      activeSessionId: runtime.sessionId,
      requestId: pending.requestId,
      claimedBy: claimant,
      connectionToken: "6666666666666666",
      model: {
        client: "claude-code 2.1.217",
        name: "claude-opus-4-8",
        sessionUrl,
      },
      baselineSnapshot: pending.premiseSnapshot,
      now: new Date(stalledAtMs).toISOString(),
      clock: () => stalledAtMs,
    });

    await agentStatusTrigger(page).click();
    const card = agentSidebar(page).locator("[data-review-current-activity]");
    await expect(card).toHaveAttribute(
      "data-review-current-activity",
      "stalled",
      { timeout: 20_000 },
    );

    // The tail names the session the reviewer sees in their own tool, and the
    // control hands over the whole bare id - not the four characters on screen,
    // and not the URL that carries it (BIG-281).
    await expect(card.locator("[data-review-agent-session-id]")).toHaveText(
      "…bf1a",
    );
    const copy = card.locator("[data-review-agent-session-copy]");
    await expect(copy).toHaveAttribute(
      "data-review-agent-session-copy",
      bareSessionId,
    );
    await copy.focus();
    await copy.press("Enter");
    // The fallback copied the bare id...
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __bigPlanCopiedCode?: string })
              .__bigPlanCopiedCode,
        ),
      )
      .toBe(bareSessionId);
    // ...and the control confirmed it, on the same insecure origin where it
    // used to sit silent (BIG-281).
    await expect(copy).toHaveAttribute(
      "aria-label",
      "agent session identifier copied",
    );
    await expect(copy).toBeFocused();
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should not contradict a stalled card in the disconnect dialog", async ({
  page,
}, testInfo) => {
  /*
  Disconnecting drops work for a working, a stalled and an errored agent alike,
  because it is the live claim that costs something rather than the health of
  whoever holds it. The destructive dialog therefore appears over a card that
  does not always say the agent is answering, and copy asserting that it is
  contradicted the headline directly above it (BIG-190).
  */
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-stalled-off-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const claimant = "cccccccccccccccc";
  const pendingQuestion = async () =>
    nextPendingAgentRequest(
      await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
      { claimedBy: claimant, nowMs: Date.now() },
    );
  try {
    await page.goto(runtime.url);
    await askPlanWideQuestion(page);
    await expect.poll(pendingQuestion, { timeout: 20_000 }).toBeDefined();
    const pending = await pendingQuestion();
    if (pending === undefined) throw new Error("The question was not stored");

    // An agent picked the question up and has narrated nothing since, so its
    // lease has lapsed: the card reads stalled while the claim is still held.
    const stalledAtMs = Date.now() - AGENT_STALL_MS - 5_000;
    await claimAgentRequest({
      store: runtime.store,
      activeSessionId: runtime.sessionId,
      requestId: pending.requestId,
      claimedBy: claimant,
      connectionToken: "6666666666666666",
      baselineSnapshot: pending.premiseSnapshot,
      now: new Date(stalledAtMs).toISOString(),
      clock: () => stalledAtMs,
    });

    await agentStatusTrigger(page).click();
    const sidebar = agentSidebar(page);
    const card = sidebar.locator("[data-review-current-activity]");
    await expect(card).toHaveAttribute(
      "data-review-current-activity",
      "stalled",
      { timeout: 20_000 },
    );
    await expect(card).toContainText("Agent may be stalled");

    // The dialog still says the work goes, because it does, but it names the
    // claim rather than a state the card above it denies.
    await sidebar.locator("[data-review-agent-disconnect]").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "This agent is holding work on this review",
    );
    await expect(dialog).toContainText(
      "the answer it has in flight is dropped rather than delivered",
    );
    await expect(dialog).not.toContainText("answering right now");
    await page.screenshot({
      path: testInfo.outputPath("disconnect-confirm-stalled.png"),
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
