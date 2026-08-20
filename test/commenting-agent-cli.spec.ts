// Minimal process-boundary journey: one real agent CLI claim and response
// crosses the same mailbox that the browser chat surface reads.

import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentExchange } from "../src/review/agent-exchange.js";
import { AGENT_CLAIM_LEASE_MS } from "../src/review/shared/agent-claim.js";
import {
  AGENT_RECOVERY_HORIZON_MS,
  AGENT_STALL_MS,
} from "../src/review/shared/agent-timing.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  grantAgentPrimacy,
  readProgress,
  readStoreJson,
  writeAgentRequestValue,
  writeStoreJson,
} from "../src/review/store.js";
import { releaseClaimsForPrimacyHandoff } from "../src/review/request-mailbox.js";
import {
  agentIdOf,
  agentSidebar,
  agentStatusTrigger,
  closeReviewRuntime,
  expect,
  runAgentCli,
  test,
  untilObserverAttaches,
} from "./fixtures";

/** The claim's own response draft path, as pickup hands it to the agent. */
const responseDraftOf = (stdout: string): string => {
  const draft = /response_file: (\S+)/u.exec(stdout)?.[1];
  if (draft === undefined) {
    throw new Error(`The agent CLI returned no response file:\n${stdout}`);
  }
  return draft;
};

const PASTED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("should carry one plan-wide chat through the real agent CLI", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-chat-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(
    planPath,
    "# Agent chat\n\nThe review has one short plan-wide question.\n",
    "utf8",
  );
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /Feedback/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail.getByRole("tab", { name: "Chat" }).click();
    const composer = rail.getByPlaceholder("Ask about the plan as a whole…");
    await composer.fill("What is the plan's purpose?");
    await composer.evaluate((element, encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (character) =>
        character.charCodeAt(0),
      );
      const file = new File([bytes], "clipboard.png", { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }),
      );
    }, PASTED_PNG.toString("base64"));
    await expect(rail.getByRole("img", { name: "Screenshot" })).toBeVisible();
    const thumbnail = rail.getByRole("button", { name: "Open Screenshot" });
    await thumbnail.click();
    // The lightbox covers the whole document rather than the rail it was
    // opened from, so it is never trapped inside a composer's own layer.
    const lightbox = page.getByRole("dialog", { name: "Screenshot" });
    await expect(lightbox).toBeVisible();
    await expect(rail.getByRole("dialog", { name: "Screenshot" })).toHaveCount(
      0,
    );
    await expect(
      lightbox.getByRole("button", { name: "Zoom out" }),
    ).toBeVisible();
    await expect(
      lightbox.getByRole("button", { name: "Fit image" }),
    ).toBeVisible();
    await expect(
      lightbox.getByRole("button", { name: "Zoom in" }),
    ).toBeVisible();
    await lightbox.getByRole("button", { name: "Zoom in" }).click();
    await lightbox.getByRole("button", { name: "Fit image" }).click();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(thumbnail).toBeFocused();
    await rail.getByRole("button", { name: "Send", exact: true }).click();

    const chat = rail.locator("li").filter({
      hasText: "What is the plan's purpose?",
    });
    await expect(chat).toContainText("Blocked - no agent connected");

    const claim = await runAgentCli(["next", planPath, "--wait"]);
    expect(claim.stdout).toContain("pending: true");
    // Pickup mints the token that proves this process holds the request; the
    // agent hands it back on every later command, as the returned
    // note_command and respond_command do.
    const agentToken = agentIdOf(claim.stdout, "agent_token");
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) => candidate.kind === "chat",
    );
    if (request === undefined) {
      throw new Error("The real agent CLI did not claim the chat request");
    }
    expect(request.attachments).toHaveLength(1);
    const attachment = request.attachments[0];
    if (attachment === undefined)
      throw new Error("Missing claimed image attachment");
    await expect(readFile(attachment.path)).resolves.toEqual(PASTED_PNG);
    expect(createHash("sha256").update(PASTED_PNG).digest("hex")).toBe(
      attachment.sha256,
    );
    expect(claim.stdout).toContain("Open every work.attachments path");
    await expect(
      readProgress({ store: runtime.store, sessionId: runtime.sessionId }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: request.requestId,
          step: "Reviewing plan question",
          state: "live",
        }),
      ]),
    );

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(chat).toContainText("Agent is working on your feedback");

    const responsePath = responseDraftOf(claim.stdout);
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId: request.requestId,
        message: "It lets a reviewer understand and discuss the plan.",
      }),
      "utf8",
    );
    const response = await runAgentCli([
      "respond",
      planPath,
      responsePath,
      "--agent",
      agentToken,
    ]);
    expect(agentIdOf(response.stdout, "responded")).toBe(request.requestId);

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(chat).toContainText(
      "It lets a reviewer understand and discuss the plan.",
    );
    await rail.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      rail.getByText("No active plan-wide questions."),
    ).toBeVisible();
    await expect(rail.getByText("Archived (1)", { exact: true })).toBeVisible();
    await expect(chat).not.toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(
      rail.getByText("No active plan-wide questions."),
    ).toBeVisible();
    await rail.getByText("Archived (1)", { exact: true }).click();
    await expect(chat).toContainText(
      "It lets a reviewer understand and discuss the plan.",
    );
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// A slide is a scope rather than a block, so highlighting a slide's title can
// only anchor to its heading. The reviewer meant the slide; before this, the
// package handed the agent the title and nothing else, and a whole-slide
// instruction quietly applied to the title alone. Only a real browser produces
// the selection, so only this journey proves what the highlight becomes.
test("should send a slide's whole content when its title is highlighted", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-slide-scope-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(
    planPath,
    "# Slide scope\n\nOne slide carries more than its title.\n\n## Sequencing\n\nWe agree the landing order before the schema ships.\n",
    "utf8",
  );
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const heading = page.getByRole("heading", { name: "Sequencing" });
    await heading.scrollIntoViewIfNeeded();
    const highlighted = await heading.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      for (
        let node = walker.nextNode();
        node !== null;
        node = walker.nextNode()
      ) {
        if (node instanceof Text && node.data.trim() !== "") last = node;
      }
      if (last === null) return "";
      const range = document.createRange();
      range.setStart(last, 0);
      range.setEnd(last, last.data.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return selection?.toString() ?? "";
    });
    expect(highlighted).toBe("Sequencing");

    await page
      .getByRole("button", { name: "Comment on selected text" })
      .click();
    await page
      .getByRole("textbox", { name: "Add a comment" })
      .fill("rewrite this in Spanish");
    await page.getByRole("button", { name: "Submit Now" }).click();

    // The package on disk is what the agent reads, so it is what the journey
    // asserts. The body has to be in it, or the rewrite reaches only the title.
    await expect
      .poll(async () => {
        const names = await readdir(runtime.store.feedbackDirectory);
        const brief = names.find((name) => name.endsWith(".md"));
        return brief === undefined
          ? ""
          : await readFile(
              join(runtime.store.feedbackDirectory, brief),
              "utf8",
            );
      })
      .toContain("We agree the landing order before the schema ships.");
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-147. The captain watched a review report "The agent is disconnected"
// while the coding agent kept working and eventually answered. `agent next`
// hands the work over and its process exits, so a turn longer than the claim
// lease renews nothing, and the runtime read that ordinary silence as a lost
// agent. This drives the whole path through the real CLI: claim, go quiet past
// the lease, then answer.
test("should report a quiet working agent as stalled rather than disconnected", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-quiet-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(
    planPath,
    "# Quiet turn\n\nThe agent takes longer than its claim lease to answer.\n",
    "utf8",
  );
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /Feedback/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail.getByRole("tab", { name: "Chat" }).click();
    const composer = rail.getByPlaceholder("Ask about the plan as a whole…");
    await composer.fill("Why does the plan start here?");
    await rail.getByRole("button", { name: "Send", exact: true }).click();

    const claim = await runAgentCli(["next", planPath, "--wait"]);
    const agentToken = agentIdOf(claim.stdout, "agent_token");
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) => candidate.kind === "chat",
    );
    if (request === undefined) {
      throw new Error("The real agent CLI did not claim the chat request");
    }

    // The turn runs long. Aging the lease and clearing the heartbeat is exactly
    // what the wall clock does to an agent that has not narrated since pickup.
    await writeAgentRequestValue({
      store: runtime.store,
      requestId: request.requestId,
      value: { ...request, claimExpiresAtMs: Date.now() - 1_000 },
    });
    await rm(runtime.store.agentHeartbeatPath, { force: true });

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await expect(
      page.getByRole("button", { name: /Agent not responding/u }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Agent disconnected/u }),
    ).toHaveCount(0);
    await agentStatusTrigger(page).click();
    const currentActivity = agentSidebar(page).locator(
      "[data-review-current-activity]",
    );
    await expect(currentActivity).toHaveAttribute(
      "data-review-current-activity",
      "stalled",
    );
    await expect(currentActivity).toContainText("Agent may be stalled");
    // Telling the reviewer to reconnect here would invite a second agent to
    // take the plan from the one still editing it (adr/0002).
    await expect(currentActivity).not.toContainText("Reconnect");

    // The agent finishes. Its answer must still land: refusing it would lose
    // the reviewer's message on the ordinary path.
    const responsePath = responseDraftOf(claim.stdout);
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId: request.requestId,
        message: "It starts there because the reader needs the status quo.",
      }),
      "utf8",
    );
    const response = await runAgentCli([
      "respond",
      planPath,
      responsePath,
      "--agent",
      agentToken,
    ]);
    expect(agentIdOf(response.stdout, "responded")).toBe(request.requestId);

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(
      rail.locator("li").filter({ hasText: "Why does the plan start here?" }),
    ).toContainText("It starts there because the reader needs the status quo.");
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-147, then BIG-171. Agent Status's connect section is always on screen, so
// its copy is the only thing telling a reviewer what a second agent will do to
// the one already here. The copy is gated on the roster rather than on held
// work now, so this drives both halves through the real CLI: which wording each
// state of the roster earns, and then the displacement itself - the reviewer
// moves the primary, and the first agent's finished answer is refused.
test("should say what connecting a second agent does while one is attached", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-held-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(
    planPath,
    "# Held work\n\nThe agent goes quiet while it still holds the request.\n",
    "utf8",
  );
  const runtime = await startReviewRuntime({ planPath });
  // The recovery section is never hidden - it holds the only recovery prompt
  // and connector command in the review - so these assert which copy it is
  // wearing, not whether it exists.
  const recoveryPanel = page.locator("[data-review-agent-recovery]");
  const plainRecovery = page.getByText("Reconnect your agent", {
    exact: true,
  });
  const joiningRecovery = page.getByText("Connect another agent", {
    exact: true,
  });
  // The agent surface has its own control in viewer chrome now; it is no longer
  // a tab inside the feedback sidebar.
  const openAgentTab = async () => {
    await page.reload();
    await agentStatusTrigger(page).click();
    await expect(agentSidebar(page)).toBeVisible();
  };
  // Ages the claim's own last signal by `quietForMs`, which is what the wall
  // clock does to an agent that has not narrated since pickup.
  const goQuiet = async (
    requestId: string,
    quietForMs = AGENT_STALL_MS + 1,
  ) => {
    const { requests } = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const current = requests.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (current === undefined) {
      throw new Error(`The exchange lost request ${requestId}`);
    }
    await writeAgentRequestValue({
      store: runtime.store,
      requestId,
      value: {
        ...current,
        claimExpiresAtMs: Date.now() - quietForMs + AGENT_CLAIM_LEASE_MS,
      },
    });
    await rm(runtime.store.agentHeartbeatPath, { force: true });
    /*
    The roster is aged in step with the claim, because it is the same silence.

    What this helper simulates is wall-clock quiet, and every record of the
    agent has to age together or the surfaces disagree about whether anyone is
    there. The connect section is gated on roster membership now (BIG-171), so
    a roster left at the present moment would report an attached agent through
    a silence long enough for every other surface to have given up on it.
    */
    const roster = await readStoreJson(runtime.store.agentRosterPath);
    if (
      typeof roster === "object" &&
      roster !== null &&
      !Array.isArray(roster)
    ) {
      const document = roster as Record<string, unknown>;
      const agents = Array.isArray(document["agents"])
        ? document["agents"]
        : [];
      // Set, never decremented: this helper is called several times in one
      // journey and each call states how long ago the agent was last heard
      // from, exactly as the claim expiry above does. Subtracting instead
      // accumulated every earlier silence into the next one.
      const lastHeardFrom = Date.now() - quietForMs;
      await writeStoreJson({
        path: runtime.store.agentRosterPath,
        value: {
          ...document,
          agents: agents.map((agent: unknown) => {
            if (typeof agent !== "object" || agent === null) return agent;
            const record = agent as Record<string, unknown>;
            return {
              ...record,
              signalAtMs: lastHeardFrom,
              // A finished turn ages with the signal that ended it, so a
              // record between two turns leaves on the same schedule.
              ...(typeof record["claimClosedAtMs"] === "number"
                ? { claimClosedAtMs: lastHeardFrom }
                : {}),
            };
          }),
        },
      });
    }
  };

  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /Feedback/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail.getByRole("tab", { name: "Chat" }).click();
    await rail
      .getByPlaceholder("Ask about the plan as a whole…")
      .fill("Which constraint drives this?");
    await rail.getByRole("button", { name: "Send", exact: true }).click();
    // The claim below reads the mailbox directly, so wait for the send to have
    // landed rather than racing the request that writes it.
    await expect(
      rail.locator("li").filter({ hasText: "Which constraint drives this?" }),
    ).toBeVisible();

    const firstClaim = await runAgentCli(["next", planPath, "--wait"]);
    const workingAgent = agentIdOf(firstClaim.stdout, "agent_token");
    const claimed = (
      await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      })
    ).requests.find((candidate) => candidate.kind === "chat");
    if (claimed === undefined) {
      throw new Error("The real agent CLI did not claim the chat request");
    }
    const requestId = claimed.requestId;
    await goQuiet(requestId);

    await openAgentTab();
    // Chat lives in the feedback sidebar; the activity card lives in the agent
    // one, and they are two surfaces now rather than two tabs of one.
    await expect(
      agentSidebar(page).locator("[data-review-current-activity]"),
    ).toHaveAttribute("data-review-current-activity", "stalled");
    // The agent is still on the roster, so the section says what connecting a
    // second one would actually do before the reviewer copies anything.
    await expect(joiningRecovery).toBeVisible();
    await expect(plainRecovery).toHaveCount(0);
    await expect(recoveryPanel).toHaveAttribute(
      "data-review-agent-recovery",
      "joining",
    );
    await joiningRecovery.click();
    await expect(recoveryPanel).toContainText("joins as an observer");
    /*
    The consequence has to be stated as the code behaves. Connecting displaces
    nobody: the attached agent keeps answering until the reviewer moves the
    primary, which is the sentence the old takeover copy got backwards
    (BIG-171).
    */
    await expect(recoveryPanel).toContainText(
      "unless you make the new agent the primary",
    );

    await goQuiet(requestId, AGENT_RECOVERY_HORIZON_MS - 60_000);
    await openAgentTab();
    await expect(joiningRecovery).toBeVisible();

    // Matrix case 4. Nothing reaps a claim, so past the recovery horizon the
    // pickup stops explaining the quiet: the card falls out of stalled, the
    // roster stops counting the agent as here, and the section drops the
    // joining copy for the plain recovery instruction.
    await goQuiet(requestId, AGENT_RECOVERY_HORIZON_MS + 60_000);
    await openAgentTab();
    await expect(joiningRecovery).toHaveCount(0);
    await expect(plainRecovery).toBeVisible();
    await expect(recoveryPanel).toHaveAttribute(
      "data-review-agent-recovery",
      "plain",
    );
    // The stale request is still open, so the card is still rendered - past the
    // horizon it reads as disconnected rather than stalled. Naming that state
    // is what a negated assertion could not do: "not stalled" would also pass
    // if the card had disappeared, which is a different failure.
    await expect(
      agentSidebar(page).locator("[data-review-current-activity]"),
    ).toHaveAttribute("data-review-current-activity", "disconnected");

    // Back inside the horizon the roster counts the agent as here again, so the
    // section returns to describing what a second agent joining would do.
    await goQuiet(requestId);
    await openAgentTab();
    await expect(joiningRecovery).toBeVisible();
    await expect(plainRecovery).toHaveCount(0);

    /*
    What following that prompt does. A second connector no longer takes a lapsed
    claim by arriving (BIG-171): it attaches as an observer and waits for the
    reviewer to move primacy, which frees the incumbent's claim in the same
    breath. The consequence the copy above warns about is unchanged, and it is
    what the rest of this block proves - the first agent's finished answer is
    refused, and the reviewer's message is the thing that would be lost.
    */
    const takeoverPickup = runAgentCli(["next", planPath, "--wait"]);
    const observer = await untilObserverAttaches(runtime);
    await releaseClaimsForPrimacyHandoff({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    await grantAgentPrimacy({
      store: runtime.store,
      sessionId: runtime.sessionId,
      writerId: observer.writerId,
    });
    const takeover = await takeoverPickup;
    expect(agentIdOf(takeover.stdout, "agent_token")).not.toBe(workingAgent);
    // Each claim drafts into its own stage, so the displaced agent's answer
    // cannot even overwrite the file the takeover will answer from.
    const displacedDraft = responseDraftOf(firstClaim.stdout);
    const takeoverDraft = responseDraftOf(takeover.stdout);
    expect(takeoverDraft).not.toBe(displacedDraft);
    await writeFile(
      displacedDraft,
      JSON.stringify({
        requestId,
        message: "The retry budget drives it, so it has to come first.",
      }),
      "utf8",
    );
    // Refused earlier and more usefully than before: the primacy check names
    // who holds the plan and reports a branchable code, where the commit's
    // generation check used to be the first thing to notice.
    await expect(
      runAgentCli([
        "respond",
        planPath,
        displacedDraft,
        "--agent",
        workingAgent,
      ]),
    ).rejects.toThrow(/no longer the primary/u);
    await expect(
      readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
    ).resolves.toMatchObject({ responses: [] });

    // The plain instruction returns once the roster has nobody left on it,
    // because then the quiet really is all the evidence there is.
    const takeoverAgent = agentIdOf(takeover.stdout, "agent_token");
    await writeFile(
      takeoverDraft,
      JSON.stringify({
        requestId,
        message: "The retry budget drives it, so it has to come first.",
      }),
      "utf8",
    );
    await runAgentCli([
      "respond",
      planPath,
      takeoverDraft,
      "--agent",
      takeoverAgent,
    ]);
    await goQuiet(requestId, AGENT_RECOVERY_HORIZON_MS + 60_000);

    await openAgentTab();
    await expect(plainRecovery).toBeVisible();
    await expect(joiningRecovery).toHaveCount(0);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
