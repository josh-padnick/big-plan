// Minimal process-boundary journey: one real agent CLI claim and response
// crosses the same mailbox that the browser chat surface reads.

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentExchange } from "../src/review/agent-exchange.js";
import { startReviewRuntime } from "../src/review/server.js";
import { agentResponseDraftPath, readProgress } from "../src/review/store.js";
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
