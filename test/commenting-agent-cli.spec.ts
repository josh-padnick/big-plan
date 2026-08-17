// Minimal process-boundary journey: one real agent CLI claim and response
// crosses the same mailbox that the browser chat surface reads.

import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentExchange } from "../src/review/agent-exchange.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  agentResponseDraftPath,
  readProgress,
  writeAgentRequestValue,
} from "../src/review/store.js";
import { expect, runAgentCli, test } from "./fixtures";

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
    const agentToken = /agent_token: ([a-f0-9]{16})/u.exec(claim.stdout)?.[1];
    if (agentToken === undefined) {
      throw new Error("The real agent CLI did not return a claim token");
    }
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

    const responsePath = agentResponseDraftPath({
      store: runtime.store,
      requestId: request.requestId,
    });
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
    expect(response.stdout).toContain(`responded: ${request.requestId}`);

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
    await runtime.close();
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
    await runtime.close();
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
    const agentToken = /agent_token: ([a-f0-9]{16})/u.exec(claim.stdout)?.[1];
    if (agentToken === undefined) {
      throw new Error("The real agent CLI did not return a claim token");
    }
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
    await rail.getByRole("tab", { name: "Agent" }).click();
    const currentActivity = rail.locator("[data-review-current-activity]");
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
    const responsePath = agentResponseDraftPath({
      store: runtime.store,
      requestId: request.requestId,
    });
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
    expect(response.stdout).toContain(`responded: ${request.requestId}`);

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(
      rail.locator("li").filter({ hasText: "Why does the plan start here?" }),
    ).toContainText("It starts there because the reader needs the status quo.");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-147. The Agent tab used to offer a pasteable "reconnect" prompt during
// exactly the quiet turn the stalled copy was written to avoid. Under adr/0002
// following that prompt invites a second agent to take the plan from the one
// still editing it, so this drives the harm itself through the real CLI: the
// takeover displaces the working agent, whose finished answer is then refused.
test("should not invite a reconnect while an agent is holding work", async ({
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
  const reconnectDisclosure = page.getByText("Re-connect your session", {
    exact: true,
  });
  const openAgentTab = async () => {
    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await page
      .getByRole("complementary", { name: "Feedback" })
      .getByRole("tab", { name: "Agent" })
      .click();
  };
  const goQuiet = async (requestId: string) => {
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
      value: { ...current, claimExpiresAtMs: Date.now() - 1_000 },
    });
    await rm(runtime.store.agentHeartbeatPath, { force: true });
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
    const workingAgent = /agent_token: ([a-f0-9]{16})/u.exec(
      firstClaim.stdout,
    )?.[1];
    if (workingAgent === undefined) {
      throw new Error("The real agent CLI did not report its claim");
    }
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
    await expect(
      rail.locator("[data-review-current-activity]"),
    ).toHaveAttribute("data-review-current-activity", "stalled");
    await expect(reconnectDisclosure).toHaveCount(0);

    // What following that prompt does. A second agent takes the lapsed claim,
    // and the first agent's finished answer is refused - the reviewer's message
    // is the thing that would be lost.
    const takeover = await runAgentCli(["next", planPath, "--wait"]);
    expect(/agent_token: ([a-f0-9]{16})/u.exec(takeover.stdout)?.[1]).not.toBe(
      workingAgent,
    );
    const displacedDraft = agentResponseDraftPath({
      store: runtime.store,
      requestId,
    });
    await writeFile(
      displacedDraft,
      JSON.stringify({
        requestId,
        message: "The retry budget drives it, so it has to come first.",
      }),
      "utf8",
    );
    await expect(
      runAgentCli([
        "respond",
        planPath,
        displacedDraft,
        "--agent",
        workingAgent,
      ]),
    ).rejects.toThrow(/does not answer the current pending request/u);
    await expect(
      readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      }),
    ).resolves.toMatchObject({ responses: [] });

    // The advice returns as soon as nobody is holding work, because then the
    // quiet really is all the evidence there is.
    const takeoverAgent = /agent_token: ([a-f0-9]{16})/u.exec(
      takeover.stdout,
    )?.[1];
    if (takeoverAgent === undefined) {
      throw new Error("The takeover did not report its claim");
    }
    await runAgentCli([
      "respond",
      planPath,
      displacedDraft,
      "--agent",
      takeoverAgent,
    ]);
    await rm(runtime.store.agentHeartbeatPath, { force: true });

    await openAgentTab();
    await expect(reconnectDisclosure).toBeVisible();
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
