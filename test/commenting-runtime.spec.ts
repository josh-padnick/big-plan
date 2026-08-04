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
  test.setTimeout(90_000);
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

  await test.step("block hover stays quiet and the slide selector has complete states", async () => {
    await page.locator("[data-block-kind='paragraph']").first().hover();
    await expect(affordance).toBeHidden();
    const selector = page.locator("[data-review-slide-selector]").first();
    await expect(selector).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await selector.hover();
      const hover = await selector.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await selector.focus();
      await expect(selector).toBeFocused();
      const box = await selector.boundingBox();
      if (box === null) throw new Error("The slide selector has no target");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const active = await selector.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await page.mouse.up();
      expect(active).not.toBe(hover);
    }
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-theme"),
    );
    await selector.click();
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the whole slide",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "false",
    );
    await expect(
      selector
        .locator("xpath=ancestor::*[@data-slide]")
        .locator("[data-slide-kicker]"),
    ).toHaveAttribute("data-review-active-highlight", "");
    await page.getByRole("heading", { level: 1 }).click();
    await expect(affordance).toBeHidden();
  });

  await test.step("the rendered feedback header owns a durable bottom border", async () => {
    await toggle.click();
    const header = page.locator("[data-review-rail-header]");
    await expect(header).toBeVisible();
    await expect
      .poll(() =>
        header.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            width: style.borderBottomWidth,
            style: style.borderBottomStyle,
            transparent:
              style.borderBottomColor === "rgba(0, 0, 0, 0)" ||
              style.borderBottomColor === "transparent",
          };
        }),
      )
      .toEqual({
        width: "1px",
        style: "solid",
        transparent: false,
      });
    await page.locator("[data-review-hide]").click();
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
    await expect(affordance).toHaveAttribute("data-review-mode", "selection");
    await expect(affordance.locator("span")).toHaveText("Comment");
    await expect(affordance.locator("span")).toBeVisible();
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

  await test.step("the connection indicator and Feedback share one vertical center", async () => {
    const alert = page.locator("[data-review-agent-alert]");
    await alert.evaluate((node) => {
      node.hidden = false;
    });
    const centers = await page
      .locator("[data-review-agent-alert], [data-review-toggle]")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return box.top + box.height / 2;
        }),
      );
    expect(centers).toHaveLength(2);
    expect(Math.abs(centers[0] - centers[1])).toBeLessThanOrEqual(0.5);
    await alert.evaluate((node) => {
      node.hidden = true;
    });
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
    await expect(
      page.locator("[data-review-compose-save] [data-review-button-label]"),
    ).toHaveText("Add Comment");
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
    // The staged card leads with its toolbar: state plus icon actions in the
    // top bar, and Submit Now as the only button in the body.
    await expect(card.locator("[data-review-thread-toolbar]")).toContainText(
      "Staged",
    );
    await expect(
      card.locator("[data-review-thread-toolbar] [data-review-thread-edit]"),
    ).toBeVisible();
    await expect(
      card.locator("[data-review-thread-toolbar] [data-review-thread-delete]"),
    ).toBeVisible();
    await expect(
      card.locator(
        "[data-review-thread-toolbar] [data-review-thread-minimize]",
      ),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      for (const control of [
        "[data-review-thread-minimize]",
        "[data-review-thread-edit]",
        "[data-review-thread-delete]",
      ]) {
        const button = card.locator(control);
        await button.hover();
        await expect(
          button.locator("[data-review-icon-tooltip]"),
        ).toBeVisible();
        const hover = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await button.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        const box = await button.boundingBox();
        if (box === null) throw new Error("The staged action has no target");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const active = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await page.mouse.move(1, 1);
        await page.mouse.up();
        expect(active).not.toBe(hover);
      }
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
    await expect(
      card.locator("[data-review-thread-actions] button"),
    ).toHaveCount(1);
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

  await test.step("anchored comment presence stays obvious and interactive below 1280 in both themes", async () => {
    await page.setViewportSize({ width: 1024, height: 900 });
    // Boot reopens the rail for restored drafts; wait for that before closing
    // so a late open cannot race the close and leave the backdrop up.
    const feedbackToggle = page.locator("[data-review-toggle]");
    await expect(feedbackToggle).toHaveAttribute("aria-expanded", "true");
    await feedbackToggle.click();
    await expect(feedbackToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-review-backdrop]")).toBeHidden();
    const anchoredBlock = page.locator('[data-block-label="versionId"]');
    await anchoredBlock.scrollIntoViewIfNeeded();
    const marker = page.locator("[data-review-marker]:visible").first();
    await expect(marker).toContainText("comment");
    const markerBox = await marker.boundingBox();
    const anchoredBox = await anchoredBlock.boundingBox();
    if (markerBox === null || anchoredBox === null) {
      throw new Error("The anchored comment marker has no pointer geometry");
    }
    expect(markerBox.width).toBeGreaterThan(40);
    expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(
      anchoredBox.x - 7.5,
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await marker.hover();
      const hover = await marker.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await marker.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(marker).toBeFocused();
      await expect
        .poll(() => marker.evaluate((node) => node.matches(":focus-visible")))
        .toBe(true);
      const box = await marker.boundingBox();
      if (box === null) throw new Error("The marker lost its pointer target");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const active = await marker.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await page.mouse.move(1, 1);
      await page.mouse.up();
      expect(active).not.toBe(hover);
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("every edited textarea has a visible keyboard focus ring", async () => {
    const feedbackToggle = page.locator("[data-review-toggle]");
    if ((await feedbackToggle.getAttribute("aria-expanded")) === "false") {
      await feedbackToggle.click();
    }
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
    await heading.click({ clickCount: 3 });
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-inline", "");
    await expect(page.locator("[data-review-thread-card]:visible")).toHaveCount(
      0,
    );
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("a slide select-all control enters the same validated flow", async () => {
    const before = await page.locator("[data-review-drafts] li").count();
    const selector = page.locator("[data-review-slide-selector]").last();
    await selector.click();
    await affordance.click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "false",
    );
    const selectedSlide = selector.locator("xpath=ancestor::*[@data-slide]");
    await expect(selectedSlide.locator("[data-slide-kicker]")).toHaveAttribute(
      "data-review-active-highlight",
      "",
    );
    await expect(
      selectedSlide.locator("[data-block-kind='heading']"),
    ).not.toHaveAttribute("data-review-active-highlight", "");
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
      const highlight = await page.evaluate(() => ({
        ranges: CSS.highlights?.get("big-plan-review-comments")?.size ?? 0,
        painted:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--annotation-bg")
            .trim() !== "",
      }));
      expect(highlight.ranges).toBeGreaterThan(0);
      expect(highlight.painted).toBe(true);
    }
  });

  await test.step("Send writes the real package without jumping the reader", async () => {
    await toggle.click();
    await page.locator('[data-review-tab="comments"]').click();
    await expect(page.locator("[data-review-send]")).toHaveText(
      "Send all comments to agent",
    );
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
    await expect(tray).toBeVisible();
    await expect(
      page.locator('[data-review-outcome-group="waiting"] [data-review-row]'),
    ).toHaveCount(3);

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
    await page.locator("[data-review-hide]").click();
  });

  await test.step("sent comments wait for a real agent instead of inventing outcomes", async () => {
    await expect(
      page.locator('[data-review-outcome-state="blocked"]'),
    ).toHaveCount(6);
    await expect(page.locator("[data-review-thread-turn='agent']")).toHaveCount(
      0,
    );
    await expect(toggle.locator("[data-review-toggle-count]")).toBeHidden();
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "No agent connected",
    );
    await expect(
      page.locator(
        '[data-review-outcome-state="blocked"] [data-review-spinner]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-review-outcome-state="blocked"] svg[aria-hidden="true"]',
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
    if ((await changed.getAttribute("data-review-thread-expanded")) === null) {
      await changed.locator("[data-review-thread-summary]").click();
    }
    await expect(changed.locator("[data-review-anchor-context]")).toContainText(
      "this text was revised",
    );
    await expect(
      changed.locator("[data-review-change-list] strong"),
    ).toHaveText("1 change across 1 slide");
    await expect(changed.locator("[data-review-change-row]")).toHaveCount(1);
    await expect(changed.locator("[data-review-see-change]")).toHaveText(
      "See the change",
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
    if ((await question.getAttribute("data-review-thread-expanded")) === null) {
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
      "Change 1 of 1 · 1 · Details",
    );
    await expect(
      lens
        .locator('[data-review-diff-op="ins"]')
        .filter({ hasText: "One-based" }),
    ).toHaveCount(1);
    expect(
      await lens.evaluate((node) => getComputedStyle(node).marginTop),
    ).toBe("0px");
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
    if (
      (await rehydratedChanged.getAttribute("data-review-thread-expanded")) ===
      null
    ) {
      await rehydratedChanged.locator("[data-review-thread-summary]").click();
    }
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
    if ((await changed.getAttribute("data-review-thread-expanded")) === null) {
      await changed
        .locator("[data-review-thread-summary]")
        .evaluate((button) => button.click());
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
    if ((await restored.getAttribute("data-review-thread-expanded")) === null) {
      await restored.locator("[data-review-thread-summary]").click();
    }
    await expect(restored.locator("[data-review-see-change]")).toHaveCount(2);
    await expect(
      restored.locator("[data-review-see-change]").first(),
    ).toHaveText("See the change");
    await expect(
      restored.locator("[data-review-see-change]").last(),
    ).toHaveText("See the change");
    await restored.locator("[data-review-see-change]").first().click();
    await expect(
      restored.locator("[data-review-see-change]").first(),
    ).toHaveText("Hide changes");
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
      "[data-review-thread-expanded] [data-review-thread-minimize]",
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
    await row.evaluate((block) => {
      const range = document.createRange();
      range.selectNodeContents(block);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
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
    if (await tray.isVisible())
      await page.locator("[data-review-hide]").click();
    const minimize = page.locator(
      "[data-review-thread-expanded] [data-review-thread-minimize]",
    );
    while ((await minimize.count()) > 0) {
      await minimize.first().click();
    }
    await page
      .locator('[data-block-label="versionId"]')
      .scrollIntoViewIfNeeded();
    const summary = page
      .locator(
        '[data-review-thread-state="sent"]:has([data-review-outcome-state="changed"]) [data-review-thread-summary]',
      )
      .first();
    await expect(summary).toBeVisible();
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
      await page.mouse.move(1, 1);
      await page.mouse.up();
      expect(active).not.toBe(hover);
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
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
    if ((await question.getAttribute("data-review-thread-expanded")) === null) {
      await question.locator("[data-review-thread-summary]").click();
    }
    await expect(question).toHaveAttribute("data-review-thread-expanded", "");
    await expect(
      question.locator("[data-review-thread-minimize]"),
    ).toBeVisible();
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
    const status = question.locator("[data-review-thread-status]");
    await expect(status).toHaveAttribute(
      "data-review-thread-status",
      "blocked",
    );
    await expect(status).toContainText("No agent connected");
    await expect(status.locator("[data-review-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "No agent connected",
    );
    await expect(
      question.locator('[data-review-outcome-state="blocked"]'),
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
      "Latest round · 1 changed · 1 needs your answer · 1 outside this plan · 0 awaiting agent",
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
    await expect(
      page.locator('[data-review-chat-message="user"]').first(),
    ).toHaveText(/most delivery risk/);
    await expect(
      page.locator('[data-review-chat-message="waiting"]'),
    ).toBeVisible();
    const chatStatus = page.locator(
      '[data-review-chat-message="waiting"] [data-review-thread-status]',
    );
    await expect(chatStatus).toHaveAttribute(
      "data-review-thread-status",
      "blocked",
    );
    await expect(chatStatus).toContainText("No agent connected");
    await expect(
      chatStatus.locator("[data-review-status-setup]"),
    ).not.toHaveAttribute("open", "");
    await expect(chatStatus.locator("[data-review-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-review-progress]")).toHaveCount(0);
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "No agent connected",
    );
    await agentCommand(["next", session.plan]);
    await expect(
      page.locator('[data-review-chat-message="waiting"]'),
    ).toContainText("Coding agent reviewing plan question", {
      timeout: 10_000,
    });
    await expect(chatStatus).toHaveAttribute(
      "data-review-thread-status",
      "working",
    );
    await expect(chatStatus.locator("[data-review-spinner]")).toHaveCount(1);
    const activityToggle = chatStatus.locator(
      "[data-review-status-activity-toggle]",
    );
    await expect(activityToggle).toBeVisible();
    await activityToggle.click();
    await expect(
      chatStatus.locator("[data-review-status-activity]"),
    ).toHaveCount(0);
    await activityToggle.click();
    await expect(
      chatStatus.locator("[data-review-status-activity]"),
    ).toBeVisible();
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
    const revisedChat =
      source
        .replace(
          "Keep every reviewer note safe while the plan is discussed.",
          "Keep each reviewer note safe while the plan is discussed.",
        )
        .replace(
          "The table has adjacent targets that must remain distinguishable.",
          "Audit boundaries are documented before implementation.",
        )
        .replace(
          "Immutable content hash of the canonical snapshot",
          "Encryption boundary with local-only durable custody and explicit reviewer-scoped session isolation",
        )
        .replace(
          "One-based position in this plan's history",
          "Retry budget and recovery window",
        )
        .replace(
          "Sending writes one real feedback package beside this plan.",
          "Sending safely writes one real feedback package beside this plan.",
        ) +
      `

## Security

Keep the review exchange local to the plan.

## Performance

Watch revision snapshots without blocking reading.

## Accessibility

Keep every change control keyboard reachable.

## Rollout

Ship the live review loop behind the explicit review command.
`;
    await writeFile(session.plan, revisedChat);
    await writeRevisionSnapshot({
      store,
      revision: deriveSourceRevision(revisedChat),
      source: revisedChat,
    });
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
        currentRevision: deriveSourceRevision(revisedChat),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.locator('[data-review-chat-message="agent"]'),
    ).toContainText("preserving comment anchors", { timeout: 10_000 });
    await expect(page.locator("[data-review-simulated]")).toHaveCount(0);
    const chatDiff = await page.evaluate(async () => {
      const root = document.documentElement;
      const headers = {
        "x-big-plan-review-token": root.getAttribute("data-review-token") || "",
      };
      const exchange = await fetch("/api/agent", { headers }).then((answer) =>
        answer.json(),
      );
      const request = exchange.requests.find(
        (entry: { kind?: string }) => entry.kind === "chat",
      );
      const response = exchange.responses.find(
        (entry: { kind?: string }) => entry.kind === "chat",
      );
      const answer = await fetch(
        "/api/revision-diff?from=" +
          encodeURIComponent(request.sourceRevision) +
          "&to=" +
          encodeURIComponent(response.sourceRevision),
        { headers },
      );
      return {
        requestRevision: request.sourceRevision,
        responseRevision: response.sourceRevision,
        diff: await answer.json(),
      };
    });
    expect(chatDiff.responseRevision).not.toBe(chatDiff.requestRevision);
    expect(chatDiff.diff.locations.length).toBeGreaterThan(0);
    const digest = page
      .locator(
        '[data-review-chat-message="agent"] [data-review-chat-change-digest]',
      )
      .first();
    await expect(
      digest.locator("[data-review-chat-change-toggle]"),
    ).toContainText(/\d+ changes across \d+ slides/);
    const chatPlaces = Number(
      (
        (await digest
          .locator("[data-review-chat-change-toggle]")
          .textContent()) || ""
      ).match(/(\d+) changes across/)?.[1],
    );
    expect(chatPlaces).toBeGreaterThan(3);
    await expect(
      digest.locator("[data-review-chat-change-toggle]"),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(digest.locator("[data-review-chat-change-list]")).toBeHidden();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      for (const control of [
        "[data-review-chat-change-toggle]",
        "[data-review-see-change]",
      ]) {
        const button = digest.locator(control);
        await button.hover();
        const hover = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await button.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        await expect
          .poll(() => button.evaluate((node) => node.matches(":focus-visible")))
          .toBe(true);
        const box = await button.boundingBox();
        if (box === null) throw new Error("The change control has no target");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const active = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await page.mouse.move(1, 1);
        await page.mouse.up();
        expect(active).not.toBe(hover);
      }
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
    await digest.locator("[data-review-chat-change-toggle]").click();
    // Slides are the grouping: expand every collapsed slide group, then all
    // places appear as rows beneath their slide headers.
    const slideGroups = digest.locator("[data-review-change-group]");
    expect(await slideGroups.count()).toBeGreaterThan(1);
    for (let index = 0; index < (await slideGroups.count()); index += 1) {
      const group = slideGroups.nth(index);
      if ((await group.getAttribute("aria-expanded")) === "false") {
        await group.click();
      }
    }
    await expect(digest.locator("[data-review-change-row]")).toHaveCount(
      chatPlaces,
    );
    await digest.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
    await expect(
      page.locator("[data-review-diff-stepper] [data-review-diff-position]"),
    ).toContainText(`Change 1 of ${chatPlaces} ·`);
    await expect(digest.locator("[data-review-see-change]")).toHaveText(
      "Hide changes",
    );
    await expect(tray).toBeVisible();
    await expect(page.locator('[data-review-tab="chat"]')).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await digest.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(page.locator("[data-review-diff-hidden]")).toHaveCount(0);

    const rewrittenRow = digest
      .locator("[data-review-change-row]")
      .filter({ hasText: "rewritten" })
      .first();
    await expect(rewrittenRow).toBeVisible();
    await rewrittenRow.click();
    await expect(page.locator("[data-review-diff-was]")).toBeVisible();
    await expect(page.locator("[data-review-diff-now]")).toBeVisible();
    await digest.locator("[data-review-see-change]").click();

    const addedRow = digest
      .locator("[data-review-change-row]")
      .filter({ hasText: "added" })
      .first();
    await addedRow.click();
    await expect(page.locator("[data-review-diff-added-run]")).toBeVisible();
    await digest.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-hidden]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();

    await page
      .locator("[data-review-agent-input]")
      .fill("Confirm the formatting-only cleanup.");
    const formattingSent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST",
    );
    await page.locator("[data-review-agent-save]").click();
    expect((await formattingSent).ok()).toBe(true);
    const formattingExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const formattingRequest = nextPendingAgentRequest(formattingExchange);
    if (formattingRequest?.kind !== "chat") {
      throw new Error("The formatting-only chat did not reach the agent");
    }
    const formattingSource = revisedChat.replace(
      "## Security\n",
      "## Security  \n",
    );
    await writeFile(session.plan, formattingSource);
    await writeRevisionSnapshot({
      store,
      revision: deriveSourceRevision(formattingSource),
      source: formattingSource,
    });
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: formattingRequest.requestId,
          message: "Formatting is clean; the rendered plan did not change.",
        },
        request: formattingRequest,
        commentsById: commentsFromExchange(formattingExchange),
        changedBlocks: new Set(),
        currentRevision: deriveSourceRevision(formattingSource),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.locator('[data-review-chat-message="agent"]'),
    ).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator("[data-review-chat-change-digest]")).toHaveCount(
      1,
    );
    const historicalDigest = page
      .locator("[data-review-chat-change-digest]")
      .first();
    await historicalDigest.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-label]")).toContainText(
      "since revised again",
    );
    await historicalDigest.locator("[data-review-see-change]").click();

    await page
      .locator("[data-review-agent-input]")
      .fill("Confirm no source edit is needed.");
    const unchangedSent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST",
    );
    await page.locator("[data-review-agent-save]").click();
    expect((await unchangedSent).ok()).toBe(true);
    const unchangedExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const unchangedRequest = nextPendingAgentRequest(unchangedExchange);
    if (unchangedRequest?.kind !== "chat") {
      throw new Error("The unchanged chat did not reach the agent");
    }
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: unchangedRequest.requestId,
          message: "No source edit was needed.",
        },
        request: unchangedRequest,
        commentsById: commentsFromExchange(unchangedExchange),
        changedBlocks: new Set(),
        currentRevision: deriveSourceRevision(formattingSource),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.locator('[data-review-chat-message="agent"]'),
    ).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator("[data-review-chat-change-digest]")).toHaveCount(
      1,
    );
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
    await expect(
      page.locator('[data-review-chat-message="user"]').first(),
    ).toHaveText(/most delivery risk/);
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
    await delivery.scrollIntoViewIfNeeded();
    await page.locator("[data-review-slide-selector]:visible").last().click();
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

    await delivery.scrollIntoViewIfNeeded();
    await page.locator("[data-review-slide-selector]:visible").last().click();
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
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      for (const control of [
        "[data-review-thread-minimize]",
        "[data-review-thread-resolve]",
        "[data-review-thread-revert]",
      ]) {
        const button = trayThread.locator(control);
        await button.hover();
        await expect(
          button.locator("[data-review-icon-tooltip]"),
        ).toBeVisible();
        const hover = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await button.focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        await expect(button).toBeFocused();
        await expect
          .poll(() => button.evaluate((node) => node.matches(":focus-visible")))
          .toBe(true);
        const box = await button.boundingBox();
        if (box === null) throw new Error("The thread action has no target");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const active = await button.evaluate(
          (node) => getComputedStyle(node).backgroundColor,
        );
        await page.mouse.move(1, 1);
        await page.mouse.up();
        expect(active).not.toBe(hover);
      }
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
    const historicalChange = trayThread
      .locator("[data-review-see-change]")
      .first();
    await historicalChange.click();
    await expect(historicalChange).toHaveText("Hide changes");
    await expect(page.locator("[data-review-diff-label]")).toContainText(
      "since revised again",
    );
    await historicalChange.click();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
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
      "Encryption boundary with local-only durable custody and explicit reviewer-scoped session isolation",
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
    await expect(
      page.locator(
        `[data-review-outcome-group] [data-review-sent-row][data-review-comment-id="${commentId}"]`,
      ),
    ).toHaveCount(0);
    await expect(
      page.locator(
        `[data-review-resolved-group] [data-review-sent-row][data-review-comment-id="${commentId}"]`,
      ),
    ).toHaveCount(1);
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
    const resolvedRow = page.locator("[data-review-resolved-group] li");
    await expect(resolvedRow).toHaveCount(1);
    await resolvedRow.locator("[data-review-row-target]").click();
    await expect(
      resolvedRow.locator("[data-review-thread-unresolve]"),
    ).toBeVisible();
    const savedUnresolve = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await resolvedRow.locator("[data-review-thread-unresolve]").click();
    expect((await savedUnresolve).ok()).toBe(true);
    await expect(page.locator("[data-review-resolved-group]")).toHaveCount(0);
    await expect(
      page.locator(
        '[data-review-outcome-group="changed"] [data-review-sent-row]',
      ),
    ).toHaveCount(1);
    const restoredRow = page.locator(
      '[data-review-outcome-group="changed"] [data-review-sent-row]',
    );
    await restoredRow.locator("[data-review-row-target]").click();
    const savedReresolve = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await restoredRow.locator("[data-review-thread-resolve]").click();
    expect((await savedReresolve).ok()).toBe(true);
    await expect(page.locator("[data-review-resolved-group]")).toHaveCount(1);
  });

  await test.step("staged selection anchors silently re-find exact quotes and degrade when the quote disappears", async () => {
    if (await tray.isVisible()) {
      await page.locator("[data-review-hide]").click();
    }
    const paragraph = page.locator(
      '[data-block-section="Delivery"][data-block-kind="paragraph"]',
    );
    const selectionCountBefore = Number(
      (await page
        .locator("html")
        .getAttribute("data-review-selection-highlight-count")) ?? "0",
    );
    await paragraph.scrollIntoViewIfNeeded();
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
      "Sending safely writes one real feedback package beside this plan.",
      "Context: Sending safely writes one real feedback package beside this plan.",
    );
    await writeFile(session.plan, moved);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      String(selectionCountBefore + 1),
    );
    await expect(page.locator("[data-review-draft-stale]")).toHaveCount(0);
    await expect(
      page.locator(
        '[data-block-section="Delivery"][data-block-kind="paragraph"]',
      ),
    ).not.toHaveAttribute("data-review-anchor-changed");

    const changed = moved.replace(
      "Sending safely writes one real feedback package",
      "Submitting safely writes one real feedback package",
    );
    await writeFile(session.plan, changed);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      String(selectionCountBefore),
    );
    await expect(page.locator("[data-review-draft-stale]")).toHaveCount(2);
    await expect(page.locator("[data-review-draft-stale]").first()).toHaveText(
      "The text changed since you drafted this.",
    );
    await expect(
      page.locator(
        '[data-block-section="Delivery"][data-block-kind="paragraph"]',
      ),
    ).toHaveAttribute("data-review-anchor-changed", "");
  });
});
