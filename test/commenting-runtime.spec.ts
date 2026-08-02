// Critical browser journey for the live `big-plan review` surface: the
// Notion-style source highlight, floating composer and comment cards, staged
// lifecycle, confirmed deletion, persistence, responsive fallback, and real
// feedback package all work together without losing the reader's position.

import { readFile, stat, writeFile } from "node:fs/promises";
import {
  commentsFromExchange,
  deriveSourceRevision,
  nextPendingAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentResponse,
} from "../src/review/agent-exchange.js";
import { agentCommand } from "../src/cli/agent/command.js";
import { reviewStoreFor, writeRevisionSnapshot } from "../src/review/store.js";
import { expect, test } from "./fixtures";

test("should preserve and send a floating review across reload and viewport changes", async ({
  page,
  reviewRuntimeUrl,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const input = document.querySelector("[data-review-agent-input]");
      if (!(input instanceof HTMLTextAreaElement)) {
        return;
      }
      document.documentElement.setAttribute(
        "data-test-first-active-draft",
        input.value,
      );
      document.documentElement.setAttribute(
        "data-test-first-draft-count",
        String(document.querySelectorAll("[data-review-drafts] li").length),
      );
      document.documentElement.setAttribute(
        "data-test-first-sent-count",
        String(document.querySelectorAll("[data-review-sent-list] li").length),
      );
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(reviewRuntimeUrl);
  const session = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.getAttribute("data-review-token") ?? "",
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
  const tray = page.locator("[data-review-rail]");
  const toggle = page.locator("[data-review-toggle]");
  const affordance = page.locator("[data-review-affordance]");
  const compose = page.locator("[data-review-compose]");

  await test.step("the toolbar entry reads as a toggle rather than a pill", async () => {
    await expect(toggle).toBeVisible();
    await expect
      .poll(() =>
        toggle.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            border: style.borderTopWidth,
            radius: style.borderTopLeftRadius,
            background: style.backgroundColor,
          };
        }),
      )
      .toEqual({
        border: "0px",
        radius: "4px",
        background: "rgba(0, 0, 0, 0)",
      });
  });

  await test.step("toolbar hover, focus, and active states stay distinct in both themes", async () => {
    for (const theme of ["light", "dark"]) {
      if ((await toggle.getAttribute("aria-expanded")) === "true") {
        await toggle.click();
      }
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await toggle.hover();
      const hover = await toggle.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await expect
        .poll(() => toggle.evaluate((node) => node.matches(":focus-visible")))
        .toBe(true);
      const box = await toggle.boundingBox();
      if (box === null) {
        throw new Error("The Comments toggle has no pointer target");
      }
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const active = await toggle.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await page.mouse.up();
      expect(active).not.toBe(hover);
    }
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-theme"),
    );
    if ((await toggle.getAttribute("aria-expanded")) === "true") {
      await toggle.click();
    }
  });

  await test.step("the hover Comment control dismisses when its trigger is left", async () => {
    await page.locator("[data-block-kind='paragraph']").first().hover();
    await expect(affordance).toBeVisible();
    await toggle.hover();
    await expect(affordance).toBeHidden();
  });

  await test.step("the selection Comment control dismisses instead of drifting on scroll", async () => {
    await page.setViewportSize({ width: 1440, height: 500 });
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ clickCount: 3 });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    const before = await affordance.boundingBox();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.move(720, 820);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .not.toBeCloseTo(scrollBefore, 0);
    await expect(affordance).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "false",
    );
    expect(before).not.toBeNull();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("a whole-paragraph selection always offers the same floating composer", async () => {
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ clickCount: 3 });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
    await expect(page.locator("[data-review-compose-save]")).toHaveText(
      "Add Comment",
    );
    await expect(
      page.locator("[data-review-submit-immediately-input]"),
    ).not.toBeChecked();
    await expect(page.locator("[data-review-compose-target]")).toHaveCount(0);
    await expect(page.locator("[data-review-compose-quote]")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "true",
    );
    const geometry = await compose.evaluate((node) => {
      const card = node.getBoundingClientRect();
      const source = document
        .querySelector("[data-block-kind='paragraph']")
        ?.getBoundingClientRect();
      return {
        sourceRight: source?.right ?? 0,
        cardLeft: card.left,
        cardRight: card.right,
        viewport: window.innerWidth,
      };
    });
    expect(geometry.cardLeft).toBeGreaterThanOrEqual(geometry.sourceRight);
    expect(geometry.cardLeft - geometry.sourceRight).toBeLessThanOrEqual(16);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewport);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.head.querySelectorAll("style"))
            .map((style) => style.textContent ?? "")
            .find((text) => text.includes("big-plan-review-comments")),
        ),
      )
      .not.toContain("text-decoration");

    const longBody =
      "This deliberately long comment proves that the floating thread stays compact until the reviewer asks for the rest. " +
      "It includes enough detail to pass the collapse threshold while remaining plain reviewer text that can be edited or removed safely.";
    await page.locator("[data-review-compose-input]").fill(longBody);
    await page.locator("[data-review-compose-save]").click();
    const card = page.locator("[data-review-thread-card]").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("You");
    await expect(card.locator("time")).not.toHaveText("");
    await expect(card.locator("[data-review-thread-more]")).toHaveText(
      "… more",
    );
    const collapsedText = await card
      .locator("[data-review-thread-body]")
      .textContent();
    expect(collapsedText).toMatch(/ … more$/);
    expect(collapsedText).not.toContain("…… more");
    expect(collapsedText?.length ?? 0).toBeLessThan(longBody.length);
    await card.locator("[data-review-thread-more]").click();
    await expect(card.locator("[data-review-thread-body]")).toHaveText(
      longBody,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      "1",
    );
  });

  await test.step("floating comments are easy to edit and require confirmation to remove", async () => {
    const card = page.locator("[data-review-thread-card]").first();
    await card.locator("[data-review-thread-edit]").click();
    const field = page.locator("[data-review-thread-input]");
    await expect(field).toBeFocused();
    await field.fill("A shorter revision before sending.");
    await page.locator("[data-review-thread-save]").click();
    await expect(page.locator("[data-review-thread-body]").first()).toHaveText(
      "A shorter revision before sending.",
    );

    await page.locator("[data-review-thread-delete]").click();
    const dialog = page.locator("[data-review-delete-dialog]");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete comment?");
    await page.locator("[data-review-delete-cancel]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(1);

    await page.locator("[data-review-thread-delete]").click();
    await page.locator("[data-review-delete-confirm]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(0);
    await expect(page.locator("[data-review-thread-card]")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      "0",
    );
  });

  await test.step("a table-cell selection enters the anchored comment flow", async () => {
    const row = page.locator('[data-block-label="versionId"]');
    await row
      .locator("td")
      .last()
      .evaluate((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
    await page
      .locator("[data-review-compose-input]")
      .fill("Explain why the content hash is stable.");
    await page.locator("[data-review-compose-save]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(1);
  });

  await test.step("another table-cell selection creates an independent anchor", async () => {
    const row = page.locator('[data-block-label="number"]');
    await row
      .locator("td")
      .last()
      .evaluate((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
    await page
      .locator("[data-review-compose-input]")
      .fill("Say whether numbering starts at one.");
    await page.locator("[data-review-compose-save]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(2);
    await expect(
      page.locator('[data-review-comment-state="staged"]'),
    ).toHaveCount(4);
    await expect(page.locator("[data-review-thread-card]")).toHaveCount(2);
  });

  await test.step("the sidebar has a top edge and complete clickable staged lifecycle", async () => {
    await toggle.click();
    await expect(tray).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() =>
        toggle.evaluate((node) => ({
          background: getComputedStyle(node).backgroundColor,
          shadow: getComputedStyle(node).boxShadow,
        })),
      )
      .not.toEqual({
        background: "rgba(0, 0, 0, 0)",
        shadow: "none",
      });
    await expect
      .poll(() =>
        tray.evaluate((node) => getComputedStyle(node).borderTopWidth),
      )
      .toBe("1px");
    const titles = page.locator(
      "[data-review-drafts] [data-review-row-target]",
    );
    await expect(titles).toHaveCount(2);
    for (const title of await titles.allTextContents()) {
      expect(title).toMatch(/^\d+(?:\.\d+)? · Details$/);
    }
    await expect(
      page.locator('[data-review-drafts] [data-review-comment-state="staged"]'),
    ).toHaveCount(2);

    await page.setViewportSize({ width: 1440, height: 500 });
    await page.locator("#delivery").scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);
    await titles.first().click();
    await expect(
      page.locator('[data-block-label="versionId"]'),
    ).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .not.toBeCloseTo(before, 0);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("the active whole-plan field and staged comments restore before first paint", async () => {
    await expect(page.locator('[data-review-tab="chat"]')).toHaveText("Chat");
    await page.locator('[data-review-tab="chat"]').click();
    const input = page.locator("[data-review-agent-input]");
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await input.fill("Unsaved reload draft must survive.");
    await saved;
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-active-draft",
      "Unsaved reload draft must survive.",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-draft-count",
      "2",
    );
    await expect(page.locator("[data-review-agent-input]")).toHaveValue(
      "Unsaved reload draft must survive.",
    );
    await expect(
      page.locator("[data-review-marker][data-review-marker-active]"),
    ).toHaveCount(2);
  });

  await test.step("every edited textarea has a visible keyboard focus ring", async () => {
    await page.locator('[data-review-tab="chat"]').click();
    const wholePlan = page.locator("[data-review-agent-input]");
    await wholePlan.click();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(wholePlan).toBeFocused();
    await expect
      .poll(() =>
        wholePlan.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            visible: node.matches(":focus-visible"),
            style: style.outlineStyle,
            width: style.outlineWidth,
          };
        }),
      )
      .toEqual({ visible: true, style: "solid", width: "1px" });

    await page.locator('[data-review-tab="comments"]').click();
    await page.locator("[data-review-row-edit]").first().click();
    const edit = page.locator("[data-review-row-input]");
    await expect(edit).toBeFocused();
    await expect
      .poll(() => edit.evaluate((node) => getComputedStyle(node).outlineStyle))
      .toBe("solid");
    await page.locator("[data-review-row-cancel]").click();
  });

  await test.step("the below-1280 drawer and inline composer preserve reading position", async () => {
    await page.locator("[data-review-hide]").click();
    await page.locator("#delivery").scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1024, height: 900 });
    const before = await page.evaluate(() => window.scrollY);
    await toggle.click();
    await expect(tray).toBeVisible();
    await expect(page.locator("[data-review-backdrop]")).toBeVisible();
    const geometry = await tray.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    const markerTops = await page
      .locator("[data-review-marker]:visible")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().top),
      );
    for (const top of markerTops) expect(top).toBeGreaterThanOrEqual(52);
    await page.locator("[data-review-backdrop]").click();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(before, 0);

    const heading = page.locator("[data-block-kind='heading']").last();
    await heading.hover();
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-inline", "");
    await expect(page.locator("[data-review-thread-card]:visible")).toHaveCount(
      0,
    );
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("a right-hand Comment button enters the same validated flow", async () => {
    const before = await page.locator("[data-review-drafts] li").count();
    const heading = page.locator("[data-block-kind='heading']").last();
    await heading.hover();
    await affordance.click();
    await expect(heading).toHaveAttribute("data-review-active-highlight", "");
    await expect(page.locator("[data-review-compose-save]")).toBeDisabled();
    await page.locator("[data-review-compose-input]").press("Control+Enter");
    await expect(compose).toBeVisible();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(before);
    await page
      .locator("[data-review-compose-input]")
      .fill("Keep this delivery note in its own anchored thread.");
    await page.locator("[data-review-compose-save]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(
      before + 1,
    );
  });

  await test.step("comment presence stays obvious without drawing through text", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      const highlighted = page
        .locator("[data-review-comment-highlight]")
        .first();
      const treatment = await highlighted.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          background: style.backgroundColor,
          offset: style.outlineOffset,
          style: style.outlineStyle,
          inset: style.boxShadow.includes("inset"),
        };
      });
      expect(treatment.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(treatment.style).toBe("solid");
      expect(treatment.offset).toBe("3px");
      expect(treatment.inset).toBe(false);
    }
  });

  await test.step("Send writes the real package without jumping the reader", async () => {
    await toggle.click();
    await page.locator('[data-review-tab="comments"]').click();
    await page
      .locator("[data-review-drafts] [data-review-row-target]")
      .last()
      .click();
    await expect(page.locator("#delivery")).toBeInViewport();
    const before = await page.evaluate(() => window.scrollY);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await page.locator("[data-review-send]").click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(before, 0);

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
    const brief = await readFile(answer.brief, "utf8");
    expect(brief).toContain("versionId");
    expect(brief).toContain("number");
    expect(brief).toContain("delivery note");
  });

  await test.step("sent comments wait for a real agent instead of inventing outcomes", async () => {
    await expect(
      page.locator('[data-review-outcome-state="waiting"]'),
    ).toHaveCount(6);
    await expect(page.locator("[data-review-thread-turn='agent']")).toHaveCount(
      0,
    );
    await expect(toggle.locator("[data-review-toggle-count]")).toBeHidden();
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "With agent",
    );
    await expect(
      page.locator(
        '[data-review-outcome-state="waiting"] [data-review-spinner]',
      ),
    ).toHaveCount(6);
  });

  await test.step("a real agent response revises the source and re-renders outcome threads live", async () => {
    const original = await readFile(session.plan, "utf8");
    await writeFile(session.plan, `${original}\n<unfinished`);
    await page.waitForTimeout(1_200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Review persistence",
    );
    await expect(page.locator("[data-review-toggle]")).toBeVisible();
    const revised = original
      .replace(
        "Content hash of the snapshot",
        "Stable content hash of the canonical snapshot",
      )
      .replace(
        "Position in this plan's history",
        "One-based position in this plan's history",
      );
    expect(revised).not.toBe(original);
    await writeFile(session.plan, revised);
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange);
    if (request?.kind !== "feedback") {
      throw new Error("The feedback request did not reach the coding agent");
    }
    expect(request.comments.at(0)?.target).toMatchObject({
      type: "selection",
      quote: "Content hash of the snapshot",
    });
    expect(request.comments.at(1)?.target).toMatchObject({
      type: "selection",
      quote: "Position in this plan's history",
    });
    const states = ["changed", "question", "outside"];
    const changeTargets = request.comments
      .slice(0, 2)
      .map((comment) =>
        "blockId" in comment.target ? comment.target.blockId : undefined,
      )
      .filter((blockId): blockId is string => blockId !== undefined);
    if (changeTargets.length !== 2) {
      throw new Error("The changed response needs both table-row targets");
    }
    expect(changeTargets).toEqual([
      await page
        .locator('[data-block-label="versionId"]')
        .getAttribute("data-block-id"),
      await page
        .locator('[data-block-label="number"]')
        .getAttribute("data-block-id"),
    ]);
    await writeRevisionSnapshot({
      store,
      revision: deriveSourceRevision(revised),
      source: revised,
    });
    const response = validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: request.comments.map((comment, index) => ({
          commentId: comment.id,
          state: states[index],
          message:
            index === 0
              ? "I clarified that the content hash is canonical and stable."
              : index === 1
                ? "Should numbering begin at zero or one?"
                : "This delivery request belongs to implementation, not this plan revision.",
          ...(index === 0 ? { changeTargets } : {}),
        })),
      },
      request,
      commentsById: commentsFromExchange(exchange),
      changedBlocks: new Set(changeTargets),
      currentRevision: deriveSourceRevision(revised),
      now: new Date().toISOString(),
    });
    await writeAgentResponse({ store, response });
    await expect(
      page.getByRole("cell", {
        name: "Stable content hash of the canonical snapshot",
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-review-outcome-state="changed"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-review-outcome-state="question"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-review-outcome-state="outside"]'),
    ).toHaveCount(2);
  });

  await test.step("changed threads list every attributed place and open an honest in-place diff lens", async () => {
    const changed = page
      .locator(
        '[data-review-thread-state="sent"]:has([data-review-outcome-state="changed"])',
      )
      .first();
    const summary = changed.locator("[data-review-thread-summary]");
    if ((await summary.getAttribute("aria-expanded")) !== "true") {
      await summary.click();
    }
    await expect(changed.locator("[data-review-anchor-context]")).toContainText(
      "this text was revised",
    );
    await expect(
      changed.locator("[data-review-change-list] strong"),
    ).toHaveText("Changed 2 places");
    await expect(changed.locator("[data-review-change-row]")).toHaveCount(2);
    await expect(changed.locator("[data-review-see-change]")).toHaveText(
      "See changes (2)",
    );
    expect(
      await page.locator("[data-review-anchor-changed]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute("data-block-id"),
          label: node.getAttribute("data-block-label"),
          text: node.textContent,
        })),
      ),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "versionId" })]),
    );

    const question = page
      .locator(
        '[data-review-thread-state="sent"]:has([data-review-outcome-state="question"])',
      )
      .first();
    if (
      (await question
        .locator("[data-review-thread-summary]")
        .getAttribute("aria-expanded")) !== "true"
    ) {
      await page
        .locator('[data-block-label="number"]')
        .scrollIntoViewIfNeeded();
      await question
        .locator("[data-review-thread-summary]")
        .evaluate((button) => button.click());
    }
    await expect(page.locator('[data-block-label="number"]')).toHaveAttribute(
      "data-review-anchor-changed",
      "",
    );
    await expect(
      question.locator("[data-review-anchor-context]"),
    ).toContainText("this text was revised");

    await page
      .locator('[data-block-label="versionId"]')
      .scrollIntoViewIfNeeded();
    await changed
      .locator("[data-review-see-change]")
      .evaluate((button) => button.click());
    const lens = page.locator("[data-review-diff-lens]");
    const stepper = page.locator("[data-review-diff-stepper]");
    await expect(lens).toBeVisible();
    await expect(
      lens
        .locator('[data-review-diff-op="del"]')
        .filter({ hasText: "Content" }),
    ).toHaveCount(1);
    await expect(
      lens.locator('[data-review-diff-op="ins"]').filter({ hasText: "Stable" }),
    ).toHaveCount(1);
    await expect(lens.locator("[data-review-diff-comment-tag]")).toHaveText(
      "your comment",
    );
    await expect(stepper.locator("[data-review-diff-position]")).toHaveText(
      "Change 1 of 2",
    );
    await stepper.locator("[data-review-diff-next]").click();
    await expect(stepper.locator("[data-review-diff-position]")).toHaveText(
      "Change 2 of 2",
    );
    await expect(
      lens
        .locator('[data-review-diff-op="ins"]')
        .filter({ hasText: "One-based" }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(lens).toHaveCount(0);
    await expect(changed).toBeVisible();
    await expect(
      page.getByRole("cell", {
        name: "Stable content hash of the canonical snapshot",
      }),
    ).toBeVisible();
    await page.reload();
    const rehydratedChanged = page
      .locator(
        '[data-review-thread-state="sent"]:has([data-review-outcome-state="changed"])',
      )
      .first();
    await expect(rehydratedChanged).toBeVisible();
    await rehydratedChanged.locator("[data-review-thread-summary]").click();
    await rehydratedChanged.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rehydratedChanged).toBeVisible();
  });

  await test.step("a second revision on the same block keeps both historical diffs pinned", async () => {
    const changed = page
      .locator(
        '[data-review-thread-state="sent"]:has([data-review-outcome-state="changed"])',
      )
      .first();
    const commentId = await changed.getAttribute("data-review-comment-id");
    if (commentId === null) {
      throw new Error("The changed thread has no comment identity");
    }
    await page
      .locator('[data-block-label="versionId"]')
      .scrollIntoViewIfNeeded();
    const summary = changed.locator("[data-review-thread-summary]");
    if ((await summary.getAttribute("aria-expanded")) !== "true") {
      await summary.evaluate((button) => button.click());
    }
    const reply = changed.locator("[data-review-thread-reply]");
    await reply.fill("Make the stability guarantee explicit.");
    const sentReply = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST",
    );
    await changed.locator("[data-review-thread-reply-send]").click();
    expect((await sentReply).ok()).toBe(true);
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange);
    if (request?.kind !== "reply") {
      throw new Error("The follow-up did not reach the coding agent");
    }
    const current = await readFile(session.plan, "utf8");
    const revised = current.replace(
      "Stable content hash of the canonical snapshot",
      "Immutable content hash of the canonical snapshot",
    );
    const target = request.commentId
      ? commentsFromExchange(exchange).get(request.commentId)?.target
      : undefined;
    const blockId =
      target !== undefined && "blockId" in target ? target.blockId : undefined;
    if (blockId === undefined) {
      throw new Error("The reply has no changed target block");
    }
    await writeFile(session.plan, revised);
    await writeRevisionSnapshot({
      store,
      revision: deriveSourceRevision(revised),
      source: revised,
    });
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "I made the stability guarantee explicit.",
              changeTargets: [blockId],
            },
          ],
        },
        request,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set([blockId]),
        currentRevision: deriveSourceRevision(revised),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.getByRole("cell", {
        name: "Immutable content hash of the canonical snapshot",
      }),
    ).toBeVisible({ timeout: 10_000 });
    const restored = page.locator(
      `[data-review-thread-state="sent"][data-review-comment-id="${commentId}"]`,
    );
    if (
      (await restored
        .locator("[data-review-thread-summary]")
        .getAttribute("aria-expanded")) !== "true"
    ) {
      await restored.locator("[data-review-thread-summary]").click();
    }
    await expect(restored.locator("[data-review-see-change]")).toHaveCount(2);
    await expect(
      restored.locator("[data-review-see-change]").first(),
    ).toHaveText("See changes (2)");
    await expect(
      restored.locator("[data-review-see-change]").last(),
    ).toHaveText("See the change");
    await restored.locator("[data-review-see-change]").first().click();
    await expect(
      page
        .locator('[data-review-diff-op="del"]')
        .filter({ hasText: "Content" }),
    ).toHaveCount(1);
    await page
      .locator("[data-review-diff-exit]")
      .evaluate((button) => button.click());
    await restored.locator("[data-review-see-change]").last().click();
    await expect(
      page.locator('[data-review-diff-op="del"]').filter({ hasText: "Stable" }),
    ).toHaveCount(1);
    await expect(
      page
        .locator('[data-review-diff-op="ins"]')
        .filter({ hasText: "Immutable" }),
    ).toHaveCount(1);
    await page
      .locator("[data-review-diff-exit]")
      .evaluate((button) => button.click());
  });

  await test.step("responses collapse to one-line outcome chips without accumulating", async () => {
    const expanded = page.locator(
      "[data-review-thread-expanded] [data-review-thread-summary]",
    );
    while ((await expanded.count()) > 0) {
      await expanded.first().evaluate((button) => button.click());
    }
    await expect(page.locator("[data-review-thread-summary]")).toHaveCount(3);
    await expect(
      page.locator('[data-review-outcome-state="changed"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-review-outcome-state="question"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-review-outcome-state="outside"]'),
    ).toHaveCount(2);
    await expect(toggle.locator("[data-review-toggle-count]")).toHaveText("1");
    const cards = page.locator('[data-review-thread-state="sent"]:visible');
    await expect(cards).toHaveCount(3);
    const density = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
    for (const height of density) expect(height).toBeLessThan(48);
    expect(density.reduce((total, height) => total + height, 0)).toBeLessThan(
      144,
    );
    await expect(page.locator("[data-review-thread-expanded]")).toHaveCount(0);
  });

  await test.step("floating composers and expanded threads never overlap neighboring controls", async () => {
    await page.setViewportSize({ width: 1440, height: 520 });
    await page
      .locator('[data-block-label="versionId"]')
      .scrollIntoViewIfNeeded();
    const summaries = page.locator("[data-review-thread-summary]");
    await expect(summaries).toHaveCount(3);
    await summaries.first().click();
    const stacked = await page
      .locator("[data-review-thread-card]:not([hidden])")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          })
          .sort((left, right) => left.top - right.top),
      );
    expect(stacked.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < stacked.length; index += 1) {
      expect(stacked[index]?.top ?? 0).toBeGreaterThanOrEqual(
        (stacked[index - 1]?.bottom ?? 0) + 7.5,
      );
    }
    const reply = page.locator(
      "[data-review-thread-expanded] [data-review-thread-reply-send]",
    );
    await expect(reply).toBeVisible();
    const replyRect = await reply.boundingBox();
    const neighboringRects = await page
      .locator(
        "[data-review-thread-card]:not([hidden]):not([data-review-thread-expanded])",
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
    if (replyRect === null) throw new Error("The Reply button has no box");
    for (const neighbor of neighboringRects) {
      expect(
        neighbor.top < replyRect.y + replyRect.height &&
          neighbor.bottom > replyRect.y,
      ).toBe(false);
    }

    const row = page.locator('[data-block-label="versionId"]');
    await row.hover();
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
    const composeRect = await compose.boundingBox();
    const cardTops = await page
      .locator("[data-review-thread-card]:not([hidden])")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().top),
      );
    if (composeRect === null) throw new Error("The composer has no box");
    for (const top of cardTops) {
      expect(top).toBeGreaterThanOrEqual(
        composeRect.y + composeRect.height + 7.5,
      );
    }
    await page.locator("[data-review-compose-cancel]").click();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("outcome tones and chip interaction states work in both themes", async () => {
    const summary = page.locator("[data-review-thread-summary]").first();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      for (const outcome of ["changed", "question", "outside"]) {
        const row = page.locator(`[data-review-outcome="${outcome}"]`);
        const colors = await row.evaluate((node) => {
          const label = node.querySelector("[data-review-outcome-state]");
          return {
            border: getComputedStyle(node).borderLeftColor,
            label: label === null ? "" : getComputedStyle(label).color,
          };
        });
        expect(colors.label).toBe(colors.border);
      }
      await summary.hover();
      const hover = await summary.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await summary.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(summary).toBeFocused();
      await expect
        .poll(() => summary.evaluate((node) => node.matches(":focus-visible")))
        .toBe(true);
      const box = await summary.boundingBox();
      if (box === null)
        throw new Error("The outcome chip has no pointer target");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const active = await summary.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await page.mouse.up();
      expect(active).not.toBe(hover);
    }
  });

  await test.step("a chip expands the complete thread in place and a reply stays in that chat", async () => {
    const questionCandidate = page
      .locator(
        '[data-review-thread-state="sent"]:has([data-review-outcome-state="question"])',
      )
      .first();
    const questionId = await questionCandidate.getAttribute(
      "data-review-comment-id",
    );
    if (questionId === null) {
      throw new Error("The question thread has no comment identity");
    }
    const question = page.locator(
      `[data-review-thread-state="sent"][data-review-comment-id="${questionId}"]`,
    );
    await question.locator("[data-review-thread-summary]").click();
    await expect(question).toHaveAttribute("data-review-thread-expanded", "");
    await expect(
      question.locator("[data-review-thread-summary]"),
    ).toBeFocused();
    await expect(
      question.locator('[data-review-thread-turn="user"]'),
    ).toHaveText(/Say whether numbering starts at one/);
    await expect(
      question.locator('[data-review-thread-turn="agent"]'),
    ).toContainText("Should numbering begin at zero or one?");
    const reply = question.locator("[data-review-thread-reply]");
    await reply.press("Control+Enter");
    await expect(
      question.locator('[data-review-thread-turn="user"]'),
    ).toHaveCount(1);
    await reply.fill("Number from one so labels match the visible sequence.");
    await question.locator("[data-review-thread-reply-send]").click();
    await expect(
      question.locator('[data-review-thread-turn="user"]'),
    ).toHaveCount(2);
    await expect(
      question.locator('[data-review-thread-turn="agent"]'),
    ).toHaveCount(1);
    await expect(
      question.locator("[data-review-thread-waiting]"),
    ).toBeVisible();
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "With agent",
    );
    await expect(
      question.locator('[data-review-outcome-state="waiting"]'),
    ).toBeVisible();
    await expect(question.locator("[data-review-thread-reply]")).toHaveCount(0);
    await expect(toggle.locator("[data-review-toggle-count]")).toBeHidden();

    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange);
    if (request?.kind !== "reply") {
      throw new Error("The thread reply did not reach the coding agent");
    }
    const source = await readFile(session.plan, "utf8");
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: [
            {
              commentId: request.commentId,
              state: "question",
              message: "Thanks. Should the first visible label be 0 or 1?",
            },
          ],
        },
        request,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set(),
        currentRevision: deriveSourceRevision(source),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      question.locator('[data-review-thread-turn="agent"]'),
    ).toHaveCount(2, { timeout: 10_000 });
    await expect(question).toContainText(
      "Should the first visible label be 0 or 1?",
    );
    await expect(toggle.locator("[data-review-toggle-count]")).toHaveText("1");
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "Needs your answer",
    );
  });

  await test.step("the lifecycle index groups outcomes and click-scrolls to the expanded anchor", async () => {
    await toggle.click();
    await expect(tray).toBeVisible();
    await expect(page.locator("[data-review-round-summary]")).toHaveText(
      "Latest round · 1 changed · 1 needs your answer · 1 outside this plan · 0 with agent",
    );
    expect(
      await page.locator("[data-review-outcome-group] h3").allTextContents(),
    ).toEqual(["Needs your answer", "Changed", "Outside this plan"]);
    for (const title of await page
      .locator("[data-review-sent-list] [data-review-row-target]")
      .allTextContents()) {
      expect(title).toMatch(/^\d+(?:\.\d+)? · (Details|Delivery)$/);
    }
    await page.setViewportSize({ width: 1440, height: 400 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => window.scrollY);
    await page
      .locator('[data-review-outcome-group="outside"] [data-review-row-target]')
      .click();
    await expect(tray).toBeVisible();
    await expect(page.locator("#delivery")).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .not.toBeCloseTo(before, 0);
    await expect(
      page.locator(
        '[data-review-sent-row][data-review-outcome="outside"] [data-review-tray-thread]',
      ),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("plan-wide chat stays separate and reaches the same real agent exchange", async () => {
    await expect(tray).toBeVisible();
    await page.locator('[data-review-tab="chat"]').click();
    const sentCount = await page
      .locator("[data-review-thread-summary]")
      .count();
    await page
      .locator("[data-review-agent-input]")
      .fill("Which part of the plan carries the most delivery risk?");
    await page.locator("[data-review-agent-save]").click();
    await expect(page.locator('[data-review-chat-message="user"]')).toHaveText(
      /most delivery risk/,
    );
    await expect(
      page.locator('[data-review-chat-message="waiting"]'),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-review-chat-message="waiting"] [data-review-spinner]',
      ),
    ).toBeVisible();
    await expect(page.locator("[data-review-progress]")).toHaveCount(0);
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "With agent",
    );
    await agentCommand(["next", session.plan]);
    await expect(
      page.locator('[data-review-chat-message="waiting"]'),
    ).toContainText("Coding agent reviewing plan question", {
      timeout: 10_000,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange);
    if (request?.kind !== "chat") {
      throw new Error("The plan chat request did not reach the coding agent");
    }
    const source = await readFile(session.plan, "utf8");
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          message:
            "The highest delivery risk is preserving comment anchors while the source changes.",
        },
        request,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set(),
        currentRevision: deriveSourceRevision(source),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.locator('[data-review-chat-message="agent"]'),
    ).toContainText("preserving comment anchors", { timeout: 10_000 });
    await expect(page.locator("[data-review-simulated]")).toHaveCount(0);
    await expect(page.locator("[data-review-thread-summary]")).toHaveCount(
      sentCount,
    );
  });

  await test.step("thread replies and plan-wide chat restore under the same plan identity", async () => {
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-active-draft",
      "",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-draft-count",
      "0",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-sent-count",
      "3",
    );
    await toggle.click();
    await page.locator('[data-review-tab="chat"]').click();
    await expect(page.locator('[data-review-chat-message="user"]')).toHaveText(
      /most delivery risk/,
    );
    await page.locator('[data-review-tab="comments"]').click();
    await page
      .locator(
        '[data-review-outcome-group="question"] [data-review-row-target]',
      )
      .click();
    await expect(
      page.locator(
        '[data-review-thread-expanded] [data-review-thread-turn="user"]',
      ),
    ).toHaveCount(2);
  });

  await test.step("an expanded sent thread uses the inline fallback below 1280", async () => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const inline = page.locator("[data-review-thread-inline]");
    await expect(inline).toBeVisible();
    await expect(inline).toHaveAttribute("data-review-thread-expanded", "");
    const geometry = await inline.evaluate((node) => {
      const card = node.getBoundingClientRect();
      return {
        left: card.left,
        right: card.right,
        viewport: window.innerWidth,
        position: getComputedStyle(node).position,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.position).toBe("relative");
  });

  await test.step("Add Comment remembers immediate-send preference and staged comments can Submit Now", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (await tray.isVisible()) {
      await page.locator("[data-review-hide]").click();
    }
    const delivery = page.locator("[data-block-kind='paragraph']").last();
    await delivery.hover();
    await affordance.click();
    const preference = page.locator("[data-review-submit-immediately-input]");
    const preferenceLabel = page.locator("[data-review-submit-immediately]");
    await expect(preference).not.toBeChecked();
    await preferenceLabel.click();
    await expect(preference).toBeChecked();
    const immediateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await page
      .locator("[data-review-compose-input]")
      .fill("Send this one without waiting for the batch.");
    await page.locator("[data-review-compose-save]").click();
    expect((await immediateResponse).ok()).toBe(true);
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(0);

    await delivery.hover();
    await affordance.click();
    await expect(preference).toBeChecked();
    await preferenceLabel.click();
    await expect(preference).not.toBeChecked();
    await page
      .locator("[data-review-compose-input]")
      .fill("Stage this one so Submit Now remains an explicit shortcut.");
    await page.locator("[data-review-compose-save]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(1);
    const submitNow = page.locator(
      '[data-review-thread-state="staged"] [data-review-thread-submit]',
    );
    await expect(submitNow).toBeVisible();
    const stagedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await submitNow.click();
    expect((await stagedResponse).ok()).toBe(true);
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(0);
  });

  await test.step("thread management minimizes, confirms a real revert, and resolves locally", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (!(await tray.isVisible())) {
      await toggle.click();
    }
    await page.locator('[data-review-tab="comments"]').click();
    const changedRow = page.locator(
      '[data-review-outcome-group="changed"] [data-review-row-target]',
    );
    await changedRow.click();
    const commentId = await changedRow
      .locator("xpath=ancestor::li[@data-review-comment-id]")
      .getAttribute("data-review-comment-id");
    if (commentId === null) throw new Error("Changed row has no comment id");
    const stableRow = page.locator(
      `[data-review-sent-row][data-review-comment-id="${commentId}"]`,
    );
    const trayThread = stableRow.locator("[data-review-tray-thread]");
    await expect(trayThread).toBeVisible();
    await expect(
      trayThread.locator("[data-review-thread-revert]"),
    ).toBeVisible();
    await expect(
      trayThread.locator("[data-review-thread-resolve]"),
    ).toBeVisible();
    await trayThread.locator("[data-review-thread-minimize]").click();
    await expect(trayThread).toHaveCount(0);
    await expect(tray).toBeVisible();

    await changedRow.click();
    await trayThread.locator("[data-review-thread-revert]").click();
    const revertDialog = page.locator("[data-review-revert-dialog]");
    await expect(revertDialog).toBeVisible();
    await expect(revertDialog).toContainText(
      "The coding agent will revert all plan changes",
    );
    await page.locator("[data-review-revert-cancel]").click();
    await expect(revertDialog).toBeHidden();

    await trayThread.locator("[data-review-thread-revert]").click();
    const revertRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().body ===
          "Revert all plan changes made in response to this comment.",
    );
    await page.locator("[data-review-revert-confirm]").click();
    expect((await revertRequest).ok()).toBe(true);
    await expect(revertDialog).toBeHidden();
    await expect(trayThread).toContainText("Revert all plan changes");

    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = exchange.requests.findLast(
      (entry) =>
        entry.kind === "reply" &&
        entry.body ===
          "Revert all plan changes made in response to this comment.",
    );
    if (request?.kind !== "reply") {
      throw new Error("The revert did not reach the coding agent");
    }
    const current = await readFile(session.plan, "utf8");
    const reverted = current.replace(
      "Immutable content hash of the canonical snapshot",
      "Content hash of the snapshot",
    );
    const target = commentsFromExchange(exchange).get(commentId)?.target;
    const blockId =
      target !== undefined && "blockId" in target ? target.blockId : undefined;
    if (blockId === undefined) {
      throw new Error("The reverted comment has no target block");
    }
    await writeFile(session.plan, reverted);
    await writeRevisionSnapshot({
      store,
      revision: deriveSourceRevision(reverted),
      source: reverted,
    });
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "I reverted this thread's plan changes.",
              changeTargets: [blockId],
            },
          ],
        },
        request,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set([blockId]),
        currentRevision: deriveSourceRevision(reverted),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.getByRole("cell", { name: "Content hash of the snapshot" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-block-label="versionId"]'),
    ).not.toHaveAttribute("data-review-anchor-changed");

    const savedResolve = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await trayThread.locator("[data-review-thread-resolve]").click();
    expect((await savedResolve).ok()).toBe(true);
    await expect(stableRow).toHaveCount(0);
    await expect(tray).toBeVisible();
  });

  await test.step("resolved threads stay retired after reload but remain findable", async () => {
    await page.reload();
    if (!(await tray.isVisible())) {
      await toggle.click();
    }
    await page.locator('[data-review-tab="comments"]').click();
    await expect(
      page.locator("[data-review-resolved-group] summary"),
    ).toHaveText("Resolved (1)");
    await page.locator("[data-review-resolved-group] summary").click();
    await expect(page.locator("[data-review-resolved-group] li")).toHaveCount(
      1,
    );
  });

  await test.step("staged selection anchors silently re-find exact quotes and degrade when the quote disappears", async () => {
    if (await tray.isVisible()) {
      await page.locator("[data-review-hide]").click();
    }
    const paragraph = page.locator("[data-block-kind='paragraph']").last();
    await paragraph.evaluate((block) => {
      const range = document.createRange();
      range.selectNodeContents(block);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await page
      .locator("[data-review-compose-input]")
      .fill("Keep this draft attached while the paragraph moves.");
    await page.locator("[data-review-compose-save]").click();

    const beforeMove = await readFile(session.plan, "utf8");
    const moved = beforeMove.replace(
      "Sending writes one real feedback package beside this plan.",
      "Context: Sending writes one real feedback package beside this plan.",
    );
    await writeFile(session.plan, moved);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      "1",
    );
    await expect(page.locator("[data-review-draft-stale]")).toHaveCount(0);
    await expect(
      page.locator("[data-block-kind='paragraph']").last(),
    ).not.toHaveAttribute("data-review-anchor-changed");

    const changed = moved.replace(
      "Sending writes one real feedback package",
      "Submitting writes one real feedback package",
    );
    await writeFile(session.plan, changed);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      "0",
    );
    await expect(page.locator("[data-review-draft-stale]")).toHaveCount(2);
    await expect(page.locator("[data-review-draft-stale]").first()).toHaveText(
      "The text changed since you drafted this.",
    );
    await expect(
      page.locator("[data-block-kind='paragraph']").last(),
    ).toHaveAttribute("data-review-anchor-changed", "");
  });
});
