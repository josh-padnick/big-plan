// Critical browser journey for the live `big-plan review` surface: the
// Notion-style source highlight, floating composer and comment cards, staged
// lifecycle, confirmed deletion, persistence, responsive fallback, and real
// feedback package all work together without losing the reader's position.

import { readFile, stat, writeFile } from "node:fs/promises";
import {
  commentsFromExchange,
  deriveSourceRevision,
  effectiveSourceRevision,
  nextPendingAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentClaim,
  writeAgentResponse,
} from "../src/review/agent-exchange.js";
import { buildRevisionChangeSet } from "../src/review/revision-change-set.js";
import { renderDocument } from "../src/render/render-document.js";
import { agentCommand } from "../src/cli/agent/command.js";
import {
  appendProgress,
  reviewStoreFor,
  readProgress,
  writeAgentHeartbeat,
  writeRevisionSnapshot,
} from "../src/review/store.js";
import { expect, test } from "./fixtures";

test("should preserve and send a floating review across reload and viewport changes", async ({
  page,
  reviewRuntimeUrl,
}) => {
  test.setTimeout(180_000);
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
  const exerciseControlStates = async ({
    control,
    property,
  }: {
    readonly control: ReturnType<typeof page.locator>;
    readonly property: "backgroundColor" | "color" | "filter" | "opacity";
  }) => {
    await control.hover();
    const hover = await control.evaluate(
      (node, styleProperty) => getComputedStyle(node)[styleProperty],
      property,
    );
    await control.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await expect
      .poll(() => control.evaluate((node) => node.matches(":focus-visible")))
      .toBe(true);
    const box = await control.boundingBox();
    if (box === null) throw new Error("The control has no pointer target");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const active = await control.evaluate(
      (node, styleProperty) => getComputedStyle(node)[styleProperty],
      property,
    );
    await page.mouse.move(1, 1);
    await page.mouse.up();
    expect(active).not.toBe(hover);
  };
  const exerciseExpandedReplyRetention = async ({
    owner,
    field,
    expandedAttribute,
  }: {
    readonly owner: ReturnType<typeof page.locator>;
    readonly field: ReturnType<typeof page.locator>;
    readonly expandedAttribute:
      "data-review-row-expanded" | "data-review-thread-expanded";
  }) => {
    const box = await field.boundingBox();
    if (box === null)
      throw new Error("The expanded reply has no pointer target");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(field).toBeFocused();
    await expect(owner).toHaveAttribute(expandedAttribute, "");
    await page.mouse.up();
    await field.click();
    await field.fill("Focused reply text stays mounted.");
    await expect(field).toHaveValue("Focused reply text stays mounted.");
    await expect(owner).toHaveAttribute(expandedAttribute, "");
    await field.press("Control+A");
    await field.press("Shift+ArrowLeft");
    await expect(field).toBeFocused();
    await expect(owner).toHaveAttribute(expandedAttribute, "");
    await owner.locator("[data-review-thread-reply-box] label").click();
    await expect(owner).toHaveAttribute(expandedAttribute, "");
    const conversation = owner.locator("[data-review-thread-turn] p").first();
    const conversationBox = await conversation.boundingBox();
    if (conversationBox !== null) {
      await page.mouse.move(
        conversationBox.x + 4,
        conversationBox.y + conversationBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        conversationBox.x + Math.max(8, conversationBox.width - 4),
        conversationBox.y + conversationBox.height / 2,
        { steps: 4 },
      );
      await page.mouse.up();
      await expect(owner).toHaveAttribute(expandedAttribute, "");
    }
    await field.fill("");
  };
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
    const kicker = selector
      .locator("xpath=ancestor::*[@data-slide]")
      .locator("[data-slide-kicker]");
    const slide = selector.locator("xpath=ancestor::*[@data-slide]");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await selector.click();
      await expect(compose).toBeVisible();
      await expect(compose).toHaveAttribute(
        "data-review-compose-placement",
        "floating",
      );
      await expect(compose).toHaveAttribute("data-review-compose-floating", "");
      await expect
        .poll(() =>
          compose.evaluate((node) => {
            const slideNode = document.querySelector(
              "[data-review-slide-highlight=active]",
            );
            const anchorNode = slideNode?.querySelector("[data-slide-kicker]");
            const composeRect = node.getBoundingClientRect();
            const anchorRect = anchorNode?.getBoundingClientRect();
            return {
              inThreadLayer:
                node.parentElement?.hasAttribute("data-review-thread-layer") ===
                true,
              rightOfSlide:
                anchorRect !== undefined &&
                composeRect.left >= anchorRect.right + 8,
              visible:
                composeRect.bottom > 44 && composeRect.top < window.innerHeight,
            };
          }),
        )
        .toEqual({
          inThreadLayer: true,
          rightOfSlide: true,
          visible: true,
        });
      await expect(affordance).toBeHidden();
      await expect(page.locator("html")).toHaveAttribute(
        "data-review-active-selection-highlight",
        "false",
      );
      await expect(slide).toHaveAttribute(
        "data-review-slide-highlight",
        "active",
      );
      await expect(kicker).not.toHaveAttribute("data-review-comment-highlight");
      await page.keyboard.press("Escape");
      await expect(compose).toBeHidden();
      await expect(affordance).toBeHidden();
      await expect(slide).not.toHaveAttribute("data-review-slide-highlight");
      await expect(kicker).not.toHaveAttribute("data-review-comment-highlight");
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.isCollapsed))
        .toBe(true);
    }
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-theme"),
    );
  });

  await test.step("whole-slide composers reuse right-side placement for first, last, and tall slides", async () => {
    await page.setViewportSize({ width: 1440, height: 520 });
    const selectors = page.locator("[data-review-slide-selector]");
    const selectorCount = await selectors.count();
    const placementCases = [
      { index: 0, tall: false },
      { index: selectorCount - 1, tall: false },
      { index: 0, tall: true },
    ];
    for (const { index, tall } of placementCases) {
      const selector = selectors.nth(index);
      const slide = page.locator("[data-slide]").nth(index);
      const anchor = slide.locator("[data-slide-kicker]");
      if (tall) {
        await slide.evaluate((node) => {
          node.setAttribute("style", "min-height:1200px");
        });
        await expect
          .poll(() =>
            slide.evaluate(
              (node) => node.getBoundingClientRect().height > innerHeight * 2,
            ),
          )
          .toBe(true);
      }
      await selector.scrollIntoViewIfNeeded();
      await selector.click();
      await expect(compose).toHaveAttribute(
        "data-review-compose-placement",
        "floating",
      );
      await expect
        .poll(async () => {
          const composeRect = await compose.boundingBox();
          const anchorRect = await anchor.boundingBox();
          return {
            rightOfSlide:
              composeRect !== null &&
              anchorRect !== null &&
              composeRect.x >= anchorRect.x + anchorRect.width + 8,
            contained:
              composeRect !== null && composeRect.x + composeRect.width <= 1440,
            visible:
              composeRect !== null &&
              composeRect.y + composeRect.height > 44 &&
              composeRect.y < 520,
          };
        })
        .toEqual({
          rightOfSlide: true,
          contained: true,
          visible: true,
        });
      await page.keyboard.press("Escape");
      if (tall) await slide.evaluate((node) => node.removeAttribute("style"));
    }

    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("the page toolbar owns one full-width bottom border", async () => {
    await toggle.click();
    const toolbar = page.locator("[data-review-toolbar]");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await expect
        .poll(() =>
          toolbar.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              left: rect.left,
              right: rect.right,
              viewport: window.innerWidth,
              width: style.borderBottomWidth,
              style: style.borderBottomStyle,
              transparent:
                style.borderBottomColor === "rgba(0, 0, 0, 0)" ||
                style.borderBottomColor === "transparent",
            };
          }),
        )
        .toEqual({
          left: 0,
          right: 1440,
          viewport: 1440,
          width: "1px",
          style: "solid",
          transparent: false,
        });
    }
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
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-theme"),
    );
    await page.locator("[data-review-hide]").click();
  });

  await test.step("Escape cancels a manual text selection in both themes", async () => {
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.scrollIntoViewIfNeeded();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await paragraph.click({ clickCount: 3 });
      await expect(affordance).toHaveAttribute(
        "aria-label",
        "Comment on the selected text",
      );
      await page.keyboard.press("Escape");
      await expect(affordance).toBeHidden();
      await expect(page.locator("html")).toHaveAttribute(
        "data-review-active-selection-highlight",
        "false",
      );
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.isCollapsed))
        .toBe(true);
    }
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-theme"),
    );
  });

  await test.step("cross-slide text remains commentable instead of being silently cleared", async () => {
    await page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll("[data-slide]"));
      const first = slides.at(0)?.querySelector("[data-block-id]");
      const second = slides.at(1)?.querySelector("[data-block-id]");
      const textNode = (root: Element | null | undefined) => {
        if (!root) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        return walker.nextNode();
      };
      const start = textNode(first);
      const end = textNode(second);
      if (!start || !end) throw new Error("Fixture needs two text slides");
      const range = document.createRange();
      range.setStart(start, Math.max(0, (start.textContent?.length ?? 0) - 4));
      range.setEnd(end, Math.min(8, end.textContent?.length ?? 0));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await expect(affordance).toBeVisible();
    await expect(page.locator("[data-review-selection-notice]")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.isCollapsed))
      .toBe(false);
    await affordance.click();
    await expect(compose).toBeVisible();
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("nested-list selection keeps its exact range and chrome selections stay quiet", async () => {
    const list = page.locator(
      '[data-block-section="Delivery"][data-block-kind="list"]',
    );
    await list.scrollIntoViewIfNeeded();
    const expected =
      "Terminal states: succeeded, exhausted, cancelled.\nTerminal rows are retained for 90 days, then archived.";
    await list.evaluate((block) => {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let start: Text | null = null;
      let end: Text | null = null;
      let node = walker.nextNode();
      while (node) {
        if (node.textContent?.includes("Terminal states:"))
          start = node as Text;
        if (node.textContent?.includes("Terminal rows are retained")) {
          end = node as Text;
        }
        node = walker.nextNode();
      }
      if (start === null || end === null) {
        throw new Error("Fixture needs the nested terminal-state list");
      }
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, end.data.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(affordance).toBeVisible();
    await affordance.click();
    await page
      .locator("[data-review-compose-input]")
      .fill("Keep this exact two-item selection.");
    await page.locator("[data-review-compose-save]").click();
    await expect(page.locator("[data-review-draft-stale]")).toHaveCount(0);
    const highlighted = await page.evaluate(() =>
      Array.from(
        CSS.highlights.get("big-plan-review-comments") ?? [],
        (range) => range.toString(),
      ).find((text) => text.startsWith("Terminal states:")),
    );
    expect(highlighted?.replaceAll(/\n+/g, "\n")).toBe(expected);
    expect(highlighted).not.toContain("worker claim");
    const staged = page
      .locator('[data-review-thread-state="staged"]')
      .filter({ hasText: "Keep this exact two-item selection." })
      .first();
    await staged.locator("[data-review-thread-delete]").click();
    await page.locator("[data-review-delete-confirm]").click();
    await expect(staged).toHaveCount(0);

    await toggle.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(affordance).toBeHidden();
    await expect(page.locator("[data-review-selection-notice]")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  await test.step("Escape preserves a typed compose draft for the same target", async () => {
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ clickCount: 3 });
    await affordance.click();
    await page
      .locator("[data-review-compose-input]")
      .fill("Keep this unfinished thought safe.");
    await page.keyboard.press("Escape");
    await expect(compose).toBeHidden();
    await paragraph.click({ clickCount: 3 });
    await affordance.click();
    await expect(page.locator("[data-review-compose-input]")).toHaveValue(
      "Keep this unfinished thought safe.",
    );
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("a floating compose keeps its document coordinate while scrolling with its target", async () => {
    await page.setViewportSize({ width: 1440, height: 500 });
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ clickCount: 3 });
    await affordance.click();
    const before = await compose.evaluate((node) => ({
      styleTop: node.style.top,
      rectTop: node.getBoundingClientRect().top,
      scrollY: window.scrollY,
    }));
    await page.mouse.move(600, 450);
    await page.mouse.wheel(0, 1200);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    const after = await compose.evaluate((node) => ({
      styleTop: node.style.top,
      rectTop: node.getBoundingClientRect().top,
      scrollY: window.scrollY,
    }));
    expect(after.styleTop).toBe(before.styleTop);
    expect(after.rectTop - before.rectTop).toBeCloseTo(
      -(after.scrollY - before.scrollY),
      0,
    );
    await expect(page.locator("[data-review-compose-context]")).toHaveCount(0);
    await page.locator("[data-review-compose-cancel]").click();
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await expect(affordance).toBeVisible();
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

  await test.step("heartbeat transitions proactively drive both toolbar indicators and an immutable open history", async () => {
    const ok = page.locator("[data-review-agent-ok]");
    const alert = page.locator("[data-review-agent-alert]");
    await writeAgentHeartbeat({
      store,
      sessionId: session.sessionId,
      state: "waiting",
    });
    await expect(ok).toBeVisible({ timeout: 8_000 });
    await expect(alert).toBeHidden();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      const dot = await ok
        .locator("[data-review-agent-ok-dot]")
        .evaluate((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            border: style.borderTopWidth,
            halo: style.boxShadow,
          };
        });
      expect(dot).toMatchObject({ width: 6, height: 6, border: "0px" });
      expect(dot.halo).toContain("0px 0px 0px 2px");
    }
    await ok.click();
    await expect(page.locator('[data-review-panel="agent"]')).toBeVisible();
    const connectionState = page.locator("[data-review-connection-state]");
    await expect
      .poll(() =>
        connectionState.evaluate((node) => {
          const alert = node.querySelector("[data-review-connection-alert]");
          const outer = getComputedStyle(node);
          const inner = alert === null ? null : getComputedStyle(alert);
          return {
            outer: outer.borderTopWidth,
            inner: inner?.borderTopWidth ?? "missing",
          };
        }),
      )
      .toEqual({ outer: "1px", inner: "missing" });
    const history = page.locator("[data-review-connection-history]");
    await history.locator("summary").click();
    await expect(history).toHaveAttribute("open", "");
    await page.waitForTimeout(2_200);
    await expect(history).toHaveAttribute("open", "");

    await expect(alert).toBeVisible({ timeout: 8_000 });
    await expect(ok).toBeHidden();
    await expect(alert).toContainText("Agent connection lost");
    const lostConnectionColors = await alert.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
      };
    });
    expect(lostConnectionColors.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(lostConnectionColors.border).toBe(lostConnectionColors.color);
    await alert.click();
    await expect(page.locator('[data-review-panel="agent"]')).toBeVisible();
    await expect(history).toHaveAttribute("open", "");
    await expect(page.locator("[data-review-recovery-command]")).toContainText(
      session.plan,
    );
    await expect(page.locator("[data-review-recovery-prompt]")).toContainText(
      "Reconnect to my existing Big Plan review",
    );
    await expect
      .poll(() =>
        connectionState.evaluate((node) => {
          const alert = node.querySelector("[data-review-connection-alert]");
          return {
            outer: getComputedStyle(node).borderTopWidth,
            inner:
              alert === null
                ? "missing"
                : getComputedStyle(alert).borderTopWidth,
          };
        }),
      )
      .toEqual({ outer: "1px", inner: "missing" });
    await expect(history.locator("summary")).toContainText("Connection log");
    await expect(
      history.locator("[data-review-connection-summary]"),
    ).toContainText("DISCONNECTED");
    await expect(
      history.locator("[data-review-connection-current]"),
    ).toContainText("Current");
    const events = history.locator("li");
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText("Disconnected");
    await expect(events.nth(1)).toContainText("Connected");
    await expect(events.nth(2)).toContainText("Disconnected");
    await expect(events.nth(0)).toContainText("Heartbeat timed out");
    const eventTimes = await events
      .locator("time")
      .evaluateAll((nodes) =>
        nodes.map((node) => Date.parse(node.getAttribute("datetime") || "")),
      );
    expect(eventTimes).toEqual([...eventTimes].sort((a, b) => b - a));
    for (const timestamp of await history.locator("time").all()) {
      expect(
        Number.isNaN(
          Date.parse((await timestamp.getAttribute("datetime")) ?? ""),
        ),
      ).toBe(false);
    }
    const prompt = page.locator("[data-review-recovery-prompt] code");
    const selectedPrompt = await prompt.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() || "";
    });
    await page.waitForTimeout(1_800);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      selectedPrompt,
    );
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    for (const selector of [
      '[data-review-copy="data-review-recovery-prompt"]',
      '[data-review-copy="data-review-recovery-command"]',
    ]) {
      const copy = page.locator(selector);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (nextTheme) =>
            document.documentElement.setAttribute("data-theme", nextTheme),
          theme,
        );
        await copy.hover();
        await copy.focus();
        await expect(copy).toBeFocused();
        const box = await copy.boundingBox();
        if (box === null) throw new Error("The copy control has no target");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.up();
      }
      await copy.click();
      await expect(copy).toContainText("Copied");
    }
    await page.locator('[data-review-tab="comments"]').click();
    await page.locator("[data-review-hide]").click();
  });

  await test.step("closing the sidebar preserves the reader's current position", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await toggle.click();
    await expect(tray).toBeVisible();
    await page.locator("#delivery").scrollIntoViewIfNeeded();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    const beforeClose = await page.evaluate(() => window.scrollY);
    await page.locator("[data-review-hide]").click();
    await expect(tray).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(beforeClose, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  await test.step("a whole-paragraph selection always offers the same floating composer", async () => {
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.click({ clickCount: 3 });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await expect(affordance).toBeVisible();
    const placement = await affordance.evaluate((node) => {
      const control = node.getBoundingClientRect();
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : new DOMRect();
      return {
        overlaps:
          control.left < range.right &&
          control.right > range.left &&
          control.top < range.bottom &&
          control.bottom > range.top,
        leftOfSelection: control.right <= range.left - 6,
        aboveSelection: control.bottom <= range.top - 6,
        horizontalGap: range.left - control.right,
        verticalGap: range.top - control.bottom,
        controlLeft: control.left,
        controlRight: control.right,
        rangeLeft: range.left,
        inlineLeft: (node as HTMLElement).style.left,
      };
    });
    expect(placement.overlaps).toBe(false);
    expect(placement.leftOfSelection).toBe(true);
    expect(placement.aboveSelection).toBe(true);
    expect(
      placement.horizontalGap,
      JSON.stringify(placement),
    ).toBeLessThanOrEqual(10);
    expect(placement.verticalGap).toBeLessThanOrEqual(10);
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
    await expect(
      page.locator("[data-review-compose-save] [data-review-button-label]"),
    ).toHaveText("Add Comment");
    const shortcutTooltip = page.locator(
      "[data-review-compose-save] [data-review-kbd-tooltip]",
    );
    await page.locator("[data-review-compose-save]").hover();
    await expect(shortcutTooltip).toBeVisible();
    await expect(shortcutTooltip).toContainText("Enter");
    await expect(shortcutTooltip).toContainText(/Add comment/i);
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
      .toContain("text-decoration:underline");
    expect(
      await page.evaluate(
        () =>
          Array.from(document.head.querySelectorAll("style"))
            .map((style) => style.textContent ?? "")
            .find((text) => text.includes("big-plan-review-comments"))
            ?.split("::highlight(big-plan-review-active)")[1],
      ),
    ).not.toContain("text-decoration");

    const longBody =
      "This deliberately long first paragraph proves that the floating thread stays compact until the reviewer asks for the rest.\n\n" +
      "unbroken-review-token-".repeat(24) +
      " closes the second paragraph without widening its bubble.";
    await page.locator("[data-review-compose-input]").fill(longBody);
    await page.locator("[data-review-compose-save]").click();
    const card = page.locator("[data-review-thread-card]").first();
    await expect(card).toBeVisible();
    // The staged card keeps STAGED in its toolbar and names both send scopes.
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
        const iconOnlyGeometry = await button.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const glyph = node.querySelector("svg")?.getBoundingClientRect();
          const tooltip = node.querySelector("[data-review-icon-tooltip]");
          return {
            width: box.width,
            height: box.height,
            centerDelta:
              glyph === undefined
                ? Number.POSITIVE_INFINITY
                : Math.abs(
                    glyph.top + glyph.height / 2 - (box.top + box.height / 2),
                  ),
            tooltipPosition:
              tooltip === null ? "" : getComputedStyle(tooltip).position,
          };
        });
        expect(iconOnlyGeometry.width).toBeCloseTo(iconOnlyGeometry.height, 1);
        expect(iconOnlyGeometry.centerDelta).toBeLessThanOrEqual(0.5);
        expect(iconOnlyGeometry.tooltipPosition).toBe("absolute");
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
    await expect(card.locator("[data-review-thread-submit]")).toHaveText(
      "Send this",
    );
    await expect(card.locator("[data-review-thread-submit-all]")).toHaveCount(
      0,
    );
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
    await expect
      .poll(() =>
        card.evaluate((node) => ({
          cardContained: node.scrollWidth <= node.clientWidth,
          bodyContained: Array.from(
            node.querySelectorAll("[data-review-thread-body]"),
          ).every((body) => body.scrollWidth <= body.clientWidth),
        })),
      )
      .toEqual({ cardContained: true, bodyContained: true });
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-selection-highlight-count",
      "1",
    );
  });

  await test.step("the selection affordance stays attached at the top of the viewport", async () => {
    const paragraph = page.locator("[data-block-kind='paragraph']").nth(1);
    await paragraph.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      window.scrollBy(0, rect.top - 48);
    });
    await paragraph.click({ clickCount: 3 });
    await expect(affordance).toBeVisible();
    const placement = await affordance.evaluate((node) => {
      const control = node.getBoundingClientRect();
      const selection = window.getSelection();
      const range =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : new DOMRect();
      return {
        top: control.top,
        leftOfSelection: control.right <= range.left - 6,
        overlaps:
          control.left < range.right &&
          control.right > range.left &&
          control.top < range.bottom &&
          control.bottom > range.top,
      };
    });
    expect(placement.top).toBeGreaterThanOrEqual(44);
    expect(placement.leftOfSelection).toBe(true);
    expect(placement.overlaps).toBe(false);
    await page.keyboard.press("Escape");
    await expect(affordance).toBeHidden();
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
    ).toHaveCount(2);
    await expect(page.locator("[data-review-thread-card]")).toHaveCount(2);
    const firstCard = page.locator("[data-review-thread-card]").first();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await firstCard.hover();
      const selectionTreatment = await firstCard.evaluate((node) => {
        const style = getComputedStyle(node);
        const connector = getComputedStyle(node, "::before");
        return {
          border: style.borderTopWidth,
          borderColor: style.borderTopColor,
          shadow: style.boxShadow,
          connectorContent: connector.content,
        };
      });
      expect(selectionTreatment.border).toBe("1px");
      expect(selectionTreatment.borderColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(selectionTreatment.shadow).not.toBe("none");
      expect(selectionTreatment.connectorContent).toBe("none");
    }
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-focus-highlight-count",
      "1",
    );
    await page.mouse.move(1, 80);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-focus-highlight-count",
      "0",
    );
    const secondCard = page.locator("[data-review-thread-card]").last();
    const sourcePoint = await row
      .locator("td")
      .last()
      .evaluate((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const rect = Array.from(range.getClientRects()).find(
          (candidate) => candidate.width > 0 && candidate.height > 0,
        );
        if (rect === undefined) {
          throw new Error("The highlighted source has no text rectangle");
        }
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      });
    await page.mouse.move(sourcePoint.x, sourcePoint.y);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-focus-highlight-count",
      "1",
    );
    await expect(secondCard).toHaveAttribute(
      "data-review-comment-emphasized",
      "",
    );
    await page.mouse.move(1, 80);
    await expect(secondCard).not.toHaveAttribute(
      "data-review-comment-emphasized",
    );
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
        page
          .locator("[data-review-toolbar]")
          .evaluate((node) => getComputedStyle(node).borderBottomWidth),
      )
      .toBe("1px");
    const zOrder = await page.evaluate(() => ({
      toolbar: Number.parseInt(
        getComputedStyle(
          document.querySelector("[data-review-toolbar]") as Element,
        ).zIndex,
        10,
      ),
      cards: Number.parseInt(
        getComputedStyle(
          document.querySelector("[data-review-thread-layer]") as Element,
        ).zIndex,
        10,
      ),
      slideSelector: Number.parseInt(
        getComputedStyle(
          document.querySelector("[data-review-slide-selector]") as Element,
        ).zIndex,
        10,
      ),
    }));
    expect(zOrder.toolbar).toBe(2_147_483_647);
    expect(zOrder.toolbar).toBeGreaterThan(zOrder.cards);
    expect(zOrder.toolbar).toBeGreaterThan(zOrder.slideSelector);
    const titles = page.locator(
      "[data-review-drafts] [data-review-row-target]",
    );
    await expect(titles).toHaveCount(2);
    for (const title of await titles.allTextContents()) {
      expect(title).toMatch(/^\d+(?:\.\d+)? · Details$/);
    }
    await expect(
      page.locator('[data-review-drafts] [data-review-comment-state="staged"]'),
    ).toHaveCount(0);
    await expect(page.locator("[data-review-draft-group] > h3")).toHaveText(
      "Staged 2",
    );
    await expect(
      page.locator(
        '[data-review-thread-state="staged"] [data-review-thread-submit-all]',
      ),
    ).toHaveText(["Send all 2", "Send all 2"]);
    const stagedCount = toggle.locator("[data-review-toggle-count]");
    await expect(stagedCount).toHaveText("2");
    await expect(stagedCount).toHaveAttribute(
      "aria-label",
      "2 staged comments waiting submission",
    );
    await expect(page.locator("[data-review-toggle-label]")).toHaveText(
      "Feedback",
    );
    await expect(page.locator("[data-review-send]")).toHaveText(
      "Send all to agent",
    );
    const toolbarSendWidth = await page
      .locator("[data-review-send]")
      .evaluate((button) => button.getBoundingClientRect().width);
    expect(toolbarSendWidth).toBeLessThan(180);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await exerciseControlStates({
        control: page.locator("[data-review-send]"),
        property: "filter",
      });
      await exerciseControlStates({
        control: page
          .locator("[data-review-drafts] [data-review-row-submit]")
          .first(),
        property: "opacity",
      });
      await exerciseControlStates({
        control: page.locator("[data-review-sidebar-send]"),
        property: "filter",
      });
    }
    await expect(
      page.locator("[data-review-drafts] [data-review-row-submit-all]"),
    ).toHaveCount(0);
    await expect(page.locator("[data-review-sidebar-send]")).toHaveCount(1);
    await page.setViewportSize({ width: 600, height: 900 });
    const compactBatch = page.locator("[data-review-batch-menu]");
    await expect(compactBatch).toBeVisible();
    await expect(compactBatch.locator("summary")).toContainText(
      "Send 2 comments",
    );
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await exerciseControlStates({
        control: compactBatch.locator("summary"),
        property: "filter",
      });
    }
    await compactBatch.locator("summary").click();
    await expect(
      compactBatch.locator("[data-review-batch-review]"),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await exerciseControlStates({
        control: compactBatch.locator("[data-review-batch-review]"),
        property: "backgroundColor",
      });
      await exerciseControlStates({
        control: compactBatch.locator("[data-review-batch-send]"),
        property: "backgroundColor",
      });
    }
    await compactBatch.locator("[data-review-batch-review]").click();
    await expect(tray).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      const badge = await stagedCount.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          width: rect.width,
          height: rect.height,
          radius: style.borderRadius,
          border: style.borderTopWidth,
          transparent:
            style.borderTopColor === "rgba(0, 0, 0, 0)" ||
            style.borderTopColor === "transparent",
        };
      });
      expect(badge.width).toBeGreaterThanOrEqual(badge.height);
      expect(badge.height).toBeGreaterThanOrEqual(18);
      expect(badge.radius).not.toBe("0px");
      expect(badge.border).toBe("1px");
      expect(badge.transparent).toBe(false);
    }
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-theme"),
    );

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
    await expect
      .poll(() =>
        page.locator('[data-block-label="versionId"]').evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
      )
      .toBeCloseTo(250, 0);

    const documentBefore = await page.evaluate(() => window.scrollY);
    const scroller = page.locator("[data-review-scroll]");
    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const firstCommentId = await page
      .locator("[data-review-drafts] [data-review-row]")
      .first()
      .getAttribute("data-review-comment-id");
    if (firstCommentId === null) {
      throw new Error("The first staged comment has no stable row id");
    }
    const selectedCell = page
      .locator('[data-block-label="versionId"] td')
      .last();
    const cellBox = await selectedCell.boundingBox();
    if (cellBox === null) {
      throw new Error("The highlighted table cell has no pointer target");
    }
    await page.mouse.click(cellBox.x + 20, cellBox.y + cellBox.height / 2);
    const trayTarget = page.locator(
      `[data-review-comment-id="${firstCommentId}"][data-review-tray-target]`,
    );
    await expect(trayTarget).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(documentBefore, 0);
    await expect
      .poll(() =>
        trayTarget.evaluate((node) => {
          const row = node.getBoundingClientRect();
          const scroll = node
            .closest("[data-review-scroll]")
            ?.getBoundingClientRect();
          return (
            scroll !== undefined &&
            row.top >= scroll.top &&
            row.bottom <= scroll.bottom
          );
        }),
      )
      .toBe(true);
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

  await test.step("the below-1280 drawer and anchored composer preserve reading position", async () => {
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
    await expect(compose).not.toHaveAttribute(
      "data-review-compose-placement",
      "centered",
    );
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.isCollapsed))
      .toBe(true);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "true",
    );
    await expect(page.locator("[data-review-thread-card]:visible")).toHaveCount(
      0,
    );
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("a slide comment control enters the same validated flow", async () => {
    const before = await page.locator("[data-review-drafts] li").count();
    const selector = page.locator("[data-review-slide-selector]").last();
    await selector.click();
    await expect(compose).toBeVisible();
    await expect(affordance).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "false",
    );
    const selectedSlide = selector.locator("xpath=ancestor::*[@data-slide]");
    await expect(selectedSlide).toHaveAttribute(
      "data-review-slide-highlight",
      "active",
    );
    await expect(
      selectedSlide.locator("[data-slide-kicker]"),
    ).not.toHaveAttribute("data-review-comment-highlight");
    await expect(
      selectedSlide.locator("[data-block-kind='heading']"),
    ).not.toHaveAttribute("data-review-active-highlight", "");
    await expect(compose).toHaveAttribute(
      "data-review-compose-placement",
      "before-slide",
    );
    await expect(compose).toHaveAttribute("data-review-compose-inline", "");
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

  await test.step("a multi-block compose stays anchored outside the highlight", async () => {
    const start = page.locator('[data-block-id="section/details/heading-1"]');
    const end = page.locator('[data-block-id="section/details/paragraph-1"]');
    await start.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const first = document.querySelector(
        '[data-block-id="section/details/heading-1"]',
      );
      const last = document.querySelector(
        '[data-block-id="section/details/paragraph-1"]',
      );
      if (!first || !last) throw new Error("Missing selection blocks");
      const range = document.createRange();
      range.selectNodeContents(first);
      range.setEnd(last, last.childNodes.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(affordance).toBeVisible();
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-inline", "");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = document.querySelector("[data-review-compose]");
          const ranges = CSS.highlights.get("big-plan-review-active");
          return {
            inReviewSurface:
              editor?.parentElement?.hasAttribute("data-review-root") === true,
            intersects:
              editor !== null &&
              ranges !== undefined &&
              [...ranges].some((range) => range.intersectsNode(editor)),
          };
        }),
      )
      .toEqual({ inReviewSurface: true, intersects: false });
    await page.locator("[data-review-compose-cancel]").click();
    await expect(end).toBeVisible();
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
      "Send all to agent",
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
      page.locator('[data-review-outcome-group="queued"] [data-review-row]'),
    ).toHaveCount(3);
    const queuedCardBox = await page
      .locator('[data-review-outcome-group="queued"] [data-review-row]')
      .first()
      .evaluate((row) => {
        const style = getComputedStyle(row);
        return {
          paddingLeft: Number.parseFloat(style.paddingLeft),
          borderWidth: Number.parseFloat(style.borderTopWidth),
        };
      });
    expect(queuedCardBox.paddingLeft).toBeGreaterThanOrEqual(8);
    expect(queuedCardBox.borderWidth).toBeGreaterThan(0);

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
    await expect(page.locator("[data-review-send-note]")).toContainText(
      "3 comments sent to the agent",
    );
    await expect(page.locator("[data-review-send-note]")).not.toContainText(
      /[a-f0-9]{12,}/,
    );
    await page.locator("[data-review-hide]").click();
  });

  await test.step("sent comments wait for a real agent instead of inventing outcomes", async () => {
    await expect(
      page.locator('[data-review-outcome-group="queued"] h3'),
    ).toContainText("Queued");
    await expect(
      page.locator(
        '[data-review-outcome-group="queued"] [data-review-outcome-group-count]',
      ),
    ).toHaveText("3");
    await expect(
      page.locator(
        '[data-review-outcome-group="queued"] [data-review-thread-resolve]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-review-outcome-state="blocked"]'),
    ).toHaveCount(3);
    await expect(
      page.locator(
        '[data-review-sent-list] [data-review-outcome-state="blocked"]',
      ),
    ).toHaveCount(0);
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
    ).toHaveCount(3);
    const blockedCard = page
      .locator('[data-review-thread-state="sent"]')
      .first();
    await blockedCard.locator("[data-review-thread-summary-toggle]").click();
    await expect(
      blockedCard.locator('[data-review-thread-turn="user"] time'),
    ).toContainText(/^Queued · /);
    await blockedCard.locator("[data-review-thread-minimize]").click();
    await agentCommand(["next", session.plan]);
    await expect(
      page.locator('[data-review-outcome-group="working"] [data-review-row]'),
    ).toHaveCount(1, { timeout: 10_000 });
    const workingCardBox = await page
      .locator('[data-review-outcome-group="working"] [data-review-row]')
      .first()
      .evaluate((row) => {
        const style = getComputedStyle(row);
        return {
          paddingLeft: Number.parseFloat(style.paddingLeft),
          borderWidth: Number.parseFloat(style.borderTopWidth),
        };
      });
    expect(workingCardBox.paddingLeft).toBeGreaterThanOrEqual(8);
    expect(workingCardBox.borderWidth).toBeGreaterThan(0);
    await expect(
      page.locator('[data-review-outcome-group="working"] h3'),
    ).toContainText("Now Working");
    await expect(
      page.locator(
        '[data-review-outcome-group="working"] [data-review-row-secondary]',
      ),
    ).toHaveText("Agent is working · Just now");
    await expect(
      page.locator(
        '[data-review-outcome-group="working"] [data-review-row-cancel-request]',
      ),
    ).toHaveText("Cancel");
    for (let index = 0; index < 12; index += 1) {
      await agentCommand([
        "note",
        session.plan,
        `Working update ${String(index + 1).padStart(2, "0")}`,
      ]);
    }
    const workingCard = page
      .locator(
        '[data-review-thread-card][data-review-thread-state="sent"][data-review-lifecycle="working"]',
      )
      .first();
    const expectVisibleSpinnerMotion = async (
      workingSpinner: ReturnType<typeof page.locator>,
    ) => {
      await expect(workingSpinner).toBeVisible();
      await expect(workingSpinner).toHaveCSS("animation-name", "spin");
      await expect(workingSpinner).toHaveCSS("animation-duration", "0.7s");
      const spinnerMotion = await workingSpinner.evaluate(async (node) => {
        const styles = window.getComputedStyle(node);
        const animation = node.getAnimations()[0];
        const before = Number(animation?.currentTime ?? 0);
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        return {
          before,
          after: Number(animation?.currentTime ?? 0),
          borderTopColor: styles.borderTopColor,
          borderRightColor: styles.borderRightColor,
        };
      });
      expect(spinnerMotion.after).toBeGreaterThan(spinnerMotion.before);
      expect(spinnerMotion.borderRightColor).toBe("rgba(0, 0, 0, 0)");
      expect(spinnerMotion.borderTopColor).not.toBe(
        spinnerMotion.borderRightColor,
      );
    };
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectVisibleSpinnerMotion(
        workingCard.locator('[data-review-spinner-variant="outcome-badge"]'),
      );
      await workingCard
        .locator("[data-review-thread-summary-toggle]")
        .click({ position: { x: 4, y: 4 } });
      await expect(
        workingCard.locator("[data-review-thread-status='working']"),
      ).toBeVisible();
      await expectVisibleSpinnerMotion(
        workingCard.locator('[data-review-spinner-variant="thread-header"]'),
      );
      await expect(
        workingCard.locator('[data-review-spinner-variant="activity-update"]'),
      ).toHaveCount(0);
      await toggle.click();
      await expectVisibleSpinnerMotion(
        page.locator(
          '[data-review-outcome-group="working"] [data-review-spinner-variant="group-heading"]',
        ),
      );
      await toggle.click();
    }
    await page.emulateMedia({ colorScheme: "light" });
    await workingCard
      .locator("[data-review-thread-summary-toggle]")
      .click({ position: { x: 4, y: 4 } });
    const cardActivityToggle = workingCard.locator(
      "[data-review-status-activity-toggle]",
    );
    await expect(cardActivityToggle).toBeVisible({ timeout: 10_000 });
    await expect(cardActivityToggle).toHaveAttribute("aria-expanded", "false");
    await expect(cardActivityToggle).toHaveText("Show 7 earlier updates");
    await expect(
      workingCard.locator("[data-review-status-current-activity]"),
    ).toContainText("Working update 12");
    await cardActivityToggle.click();
    const cardActivity = workingCard.locator("[data-review-status-activity]");
    await expect(cardActivity.locator("li")).toHaveCount(7, {
      timeout: 10_000,
    });
    await expect
      .poll(() =>
        cardActivity.evaluate((node) => node.scrollWidth <= node.clientWidth),
      )
      .toBe(true);
    const cardScroll = await cardActivity.evaluate((node) => {
      node.scrollTop = Math.min(24, node.scrollHeight - node.clientHeight);
      return {
        top: node.scrollTop,
        scrollable: node.scrollHeight > node.clientHeight,
      };
    });
    expect(cardScroll.scrollable).toBe(true);
    expect(cardScroll.top).toBeGreaterThan(0);
    await agentCommand(["note", session.plan, "Working update 14"]);
    await expect(cardActivity.locator("li")).toHaveCount(7, {
      timeout: 10_000,
    });
    await expect(
      workingCard.locator("[data-review-status-current-activity]"),
    ).toContainText("Working update 14");
    await expect
      .poll(() => cardActivity.evaluate((node) => node.scrollTop))
      .toBe(cardScroll.top);
    const preserveVisibleScroll = async ({
      expectedKey,
      update,
    }: {
      readonly expectedKey: string;
      readonly update: string;
    }): Promise<void> => {
      const positions = await page.evaluate((keyPrefix) => {
        const style = document.createElement("style");
        style.id = "review-scroll-preservation-fixture";
        style.textContent =
          "[data-review-scroll-key]{max-height:40px!important;overflow-y:auto!important}" +
          "[data-review-scroll-key]::after{content:'';display:block;height:80px}";
        document.head.appendChild(style);
        return Array.from(
          document.querySelectorAll<HTMLElement>("[data-review-scroll-key]"),
        )
          .filter(
            (node) =>
              node.getClientRects().length > 0 &&
              (node.getAttribute("data-review-scroll-key") ?? "").startsWith(
                keyPrefix,
              ),
          )
          .map((node) => {
            node.scrollTop = Math.min(
              20,
              node.scrollHeight - node.clientHeight,
            );
            return {
              key: node.getAttribute("data-review-scroll-key") ?? "",
              top: node.scrollTop,
            };
          });
      }, expectedKey);
      expect(positions.some(({ key }) => key.startsWith(expectedKey))).toBe(
        true,
      );
      for (const position of positions) {
        expect(position.top).toBeGreaterThan(0);
      }
      await agentCommand(["note", session.plan, update]);
      await expect
        .poll(() =>
          page.evaluate(
            (expected) =>
              expected.map(({ key }) => {
                const node = Array.from(
                  document.querySelectorAll<HTMLElement>(
                    "[data-review-scroll-key]",
                  ),
                ).find(
                  (candidate) =>
                    candidate.getAttribute("data-review-scroll-key") === key,
                );
                return { key, top: node?.scrollTop ?? -1 };
              }),
            positions,
          ),
        )
        .toEqual(positions);
      await page
        .locator("#review-scroll-preservation-fixture")
        .evaluate((node) => node.remove());
    };
    await preserveVisibleScroll({
      expectedKey: "activity:",
      update: "Working update 15",
    });
    await expect(
      workingCard.locator("[data-review-status-current-activity]"),
    ).toContainText("Working update 15");
    const cancelRequest = workingCard.locator("[data-review-cancel-request]");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await cancelRequest.hover();
      await expect(cancelRequest).toHaveCSS("cursor", "pointer");
      const hover = await cancelRequest.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      expect(hover).not.toBe("rgba(0, 0, 0, 0)");
      await cancelRequest.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect
        .poll(() =>
          cancelRequest.evaluate((node) => node.matches(":focus-visible")),
        )
        .toBe(true);
      const box = await cancelRequest.boundingBox();
      if (box === null) throw new Error("Cancel request has no pointer target");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const active = await cancelRequest.evaluate(
        (node) => getComputedStyle(node).opacity,
      );
      await page.mouse.move(1, 1);
      await page.mouse.up();
      expect(active).not.toBe("1");
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );

    await toggle.click();
    const trayWorkingRow = page
      .locator('[data-review-outcome-group="working"] [data-review-row]')
      .first();
    await trayWorkingRow.locator("[data-review-row-target]").click();
    const trayActivity = trayWorkingRow.locator(
      "[data-review-status-activity]",
    );
    await expect(trayActivity).toBeVisible();
    await expect
      .poll(() =>
        trayActivity.evaluate((node) => ({
          overflow: getComputedStyle(node).overflowY,
          contained: node.scrollHeight <= node.clientHeight,
        })),
      )
      .toEqual({ overflow: "visible", contained: true });
    await preserveVisibleScroll({
      expectedKey: "comments",
      update: "Working update 16",
    });
    await page.locator('[data-review-tab="chat"]').click();
    await preserveVisibleScroll({
      expectedKey: "chat",
      update: "Working update 17",
    });
    await page.locator('[data-review-tab="agent"]').click();
    await preserveVisibleScroll({
      expectedKey: "connection",
      update: "Working update 18",
    });
    await page.locator('[data-review-tab="comments"]').click();
    await writeFile(
      store.agentHeartbeatPath,
      JSON.stringify({
        sessionId: session.sessionId,
        state: "working",
        updatedAtMs: 0,
      }),
    );
    await expect(page.locator("[data-review-agent-alert]")).toBeVisible({
      timeout: 8_000,
    });
    await page.locator("[data-review-hide]").click();
  });

  await test.step("a real agent response revises the source and re-renders outcome threads live", async () => {
    const original = await readFile(session.plan, "utf8");
    await writeFile(session.plan, `${original}\n<unfinished`);
    await page.waitForTimeout(1_200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Review persistence",
    );
    await expect(page.locator("[data-review-toggle]")).toBeVisible();
    await page.locator("[data-review-toggle]").click();
    await page.locator('[data-review-tab="chat"]').click();
    const preservedComposerText =
      "Keep this plan-wide draft while the source refreshes.";
    await page.locator("[data-review-agent-input]").fill(preservedComposerText);
    await page.locator('[data-review-tab="comments"]').click();
    const preservedThread = page
      .locator('[data-review-outcome-group="working"] [data-review-row]')
      .first();
    const preservedThreadId = await preservedThread.getAttribute(
      "data-review-comment-id",
    );
    if (preservedThreadId === null) {
      throw new Error("The source refresh needs an open thread to preserve");
    }
    await preservedThread.locator("[data-review-row-target]").click();
    await expect(preservedThread).toHaveAttribute(
      "data-review-row-expanded",
      "",
    );
    const refreshState = await page.evaluate(() => {
      const anchor = document.querySelector('[data-block-label="number"]');
      if (!(anchor instanceof HTMLElement)) {
        throw new Error("The source refresh has no viewport anchor");
      }
      anchor.scrollIntoView({ block: "center" });
      const readingAnchor = Array.from(
        document.querySelectorAll<HTMLElement>("[data-block-id]"),
      )
        .map((block) => ({ block, rect: block.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > 52 && rect.top < innerHeight)
        .sort(
          (left, right) =>
            Math.abs(left.rect.top - 52) - Math.abs(right.rect.top - 52),
        )[0];
      if (readingAnchor === undefined) {
        throw new Error("The source refresh has no visible reading anchor");
      }
      const sentinel = crypto.randomUUID();
      (
        window as Window & { __bigPlanSourceRefreshSentinel?: string }
      ).__bigPlanSourceRefreshSentinel = sentinel;
      return { sentinel };
    });
    const revised =
      original
        .replace(
          "Content hash of the snapshot",
          "Stable content hash of the canonical snapshot",
        )
        .replace(
          "Position in this plan's history",
          "One-based position in this plan's history",
        ) +
      "\n\nOperators can inspect the persisted feedback package during review.\n";
    expect(revised).not.toBe(original);
    await writeFile(session.plan, revised);
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const requests = exchange.requests.filter(
      (candidate) => candidate.kind === "feedback",
    );
    const request = nextPendingAgentRequest(exchange);
    if (request?.kind !== "feedback" || requests.length < 3) {
      throw new Error("The feedback request did not reach the coding agent");
    }
    expect(request.comments.at(0)?.target).toMatchObject({
      type: "selection",
      quote: "Content hash of the snapshot",
    });
    expect(requests[1]?.comments.at(0)?.target).toMatchObject({
      type: "selection",
      quote: "Position in this plan's history",
    });
    const changeTargets = requests
      .slice(0, 2)
      .flatMap((candidate) => candidate.comments)
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
    const pair = {
      fromRevision: deriveSourceRevision(original),
      toRevision: deriveSourceRevision(revised),
    };
    const render = (markdown: string) =>
      renderDocument({
        markdown,
        fallbackTitle: "Review persistence",
        identity: {},
      }).blocks;
    const changeSet = buildRevisionChangeSet({
      pair,
      before: render(original),
      after: render(revised),
    });
    const response = validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: [
          {
            commentId: request.comments[0]?.id,
            state: "changed",
            message:
              "I clarified the canonical snapshot, history position, and inspection guidance in this one owned revision.",
            changes: changeSet.places.map((place) => ({
              placeId: place.placeId,
              summary: place.label,
            })),
          },
        ],
      },
      request,
      commentsById: commentsFromExchange(exchange),
      changedPlaceIds: new Set(changeSet.places.map((place) => place.placeId)),
      fromRevision: pair.fromRevision,
      currentRevision: deriveSourceRevision(revised),
      now: new Date().toISOString(),
    });
    await writeAgentResponse({ store, response });
    let nextExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const queuedQuestionRequest = nextPendingAgentRequest(nextExchange);
    if (queuedQuestionRequest?.kind !== "feedback") {
      throw new Error("The second serialized comment was not queued");
    }
    const questionRequest = {
      ...queuedQuestionRequest,
      claimedFromRevision: deriveSourceRevision(revised),
    };
    await writeAgentClaim({ store, request: questionRequest });
    nextExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const queuedLabels = page.locator(
      '[data-review-outcome-group="queued"] [data-review-row-secondary]',
    );
    await expect(queuedLabels).toHaveCount(0, { timeout: 10_000 });
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: questionRequest.requestId,
          outcomes: [
            {
              commentId: questionRequest.comments[0]?.id,
              state: "question",
              message: "Should numbering begin at zero or one?",
            },
          ],
        },
        request: questionRequest,
        commentsById: commentsFromExchange(nextExchange),
        changedPlaceIds: new Set(),
        fromRevision: effectiveSourceRevision({
          request: questionRequest,
          snapshot: nextExchange,
        }),
        currentRevision: deriveSourceRevision(revised),
        now: new Date().toISOString(),
      }),
    });
    nextExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const queuedOutsideRequest = nextPendingAgentRequest(nextExchange);
    if (queuedOutsideRequest?.kind !== "feedback") {
      throw new Error("The third serialized comment was not queued");
    }
    const outsideRequest = {
      ...queuedOutsideRequest,
      claimedFromRevision: deriveSourceRevision(revised),
    };
    await writeAgentClaim({ store, request: outsideRequest });
    nextExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    await writeAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: outsideRequest.requestId,
          outcomes: [
            {
              commentId: outsideRequest.comments[0]?.id,
              state: "outside",
              message:
                "This delivery request belongs to implementation, not this plan revision.",
            },
          ],
        },
        request: outsideRequest,
        commentsById: commentsFromExchange(nextExchange),
        changedPlaceIds: new Set(),
        fromRevision: effectiveSourceRevision({
          request: outsideRequest,
          snapshot: nextExchange,
        }),
        currentRevision: deriveSourceRevision(revised),
        now: new Date().toISOString(),
      }),
    });
    await expect(
      page.getByRole("cell", {
        name: "Stable content hash of the canonical snapshot",
      }),
    ).toBeVisible({ timeout: 10_000 });
    const preservedRefreshState = await page.evaluate(
      ({ threadId }) => {
        const thread = document.querySelector(
          `[data-review-comment-id="${CSS.escape(threadId)}"][data-review-row]`,
        );
        return {
          sentinel: (
            window as Window & { __bigPlanSourceRefreshSentinel?: string }
          ).__bigPlanSourceRefreshSentinel,
          anchorDelta: Number(
            document.documentElement.getAttribute(
              "data-review-source-anchor-delta",
            ),
          ),
          refreshState: document.documentElement.getAttribute(
            "data-review-source-refresh",
          ),
          railOpen:
            document
              .querySelector("[data-review-rail]")
              ?.hasAttribute("hidden") === false,
          commentsSelected:
            document
              .querySelector('[data-review-tab="comments"]')
              ?.getAttribute("aria-selected") === "true",
          threadExpanded: thread?.hasAttribute("data-review-row-expanded"),
        };
      },
      {
        threadId: preservedThreadId,
      },
    );
    expect(preservedRefreshState.sentinel).toBe(refreshState.sentinel);
    expect(preservedRefreshState.refreshState).toBe("complete");
    expect(preservedRefreshState.anchorDelta).toBeLessThanOrEqual(2);
    expect(preservedRefreshState.railOpen).toBe(true);
    expect(preservedRefreshState.commentsSelected).toBe(true);
    expect(preservedRefreshState.threadExpanded).toBe(true);
    await page.locator('[data-review-tab="chat"]').click();
    await expect(page.locator("[data-review-agent-input]")).toHaveValue(
      preservedComposerText,
    );
    await page.locator('[data-review-tab="comments"]').click();
    await page.locator("[data-review-hide]").click();
    await expect(
      page.locator('[data-review-outcome-state="changed"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-review-outcome-state="question"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-review-outcome-state="outside"]'),
    ).toHaveCount(1);
  });

  await test.step("changed threads list every attributed place and open an honest in-place diff lens", async () => {
    const changed = page
      .locator(
        '[data-review-thread-state="sent"][data-review-outcome="changed"]',
      )
      .first();
    if ((await changed.getAttribute("data-review-thread-expanded")) === null) {
      await changed.locator("[data-review-thread-summary-toggle]").click();
    }
    const floatingHeader = changed.locator(
      ":scope > [data-review-thread-toolbar]",
    );
    await expect(
      floatingHeader.locator("[data-review-thread-minimize]"),
    ).toBeVisible();
    await expect(
      floatingHeader.locator("[data-review-thread-resolve]"),
    ).toBeVisible();
    await expect(
      floatingHeader.locator("[data-review-thread-revert]"),
    ).toBeVisible();
    const headerGeometry = await changed.evaluate((card) => {
      const header = card.querySelector(
        ":scope > [data-review-thread-toolbar]",
      );
      if (!(header instanceof HTMLElement)) {
        throw new Error("Expanded thread has no header");
      }
      const cardRect = card.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      return {
        leftDelta: Math.abs(headerRect.left - cardRect.left),
        rightDelta: Math.abs(headerRect.right - cardRect.right),
        contained: card.scrollWidth <= card.clientWidth,
      };
    });
    expect(headerGeometry.leftDelta).toBeLessThanOrEqual(1);
    expect(headerGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(headerGeometry.contained).toBe(true);
    await expect(changed.locator("[data-review-anchor-context]")).toContainText(
      "this text was revised",
    );
    await expect(
      changed.locator("[data-review-change-list] strong"),
    ).toHaveText("3 changes across 2 slides");
    const changeRows = changed.locator("[data-review-change-row]");
    await expect(changeRows).toHaveCount(3);
    const changeRow = changeRows.first();
    const wrapMetrics = await changeRow.evaluate((row) => {
      row.style.width = "7rem";
      const label = row.querySelector("[data-review-change-label]");
      if (!(label instanceof HTMLElement)) {
        throw new Error("The change row has no label");
      }
      return {
        whiteSpace: getComputedStyle(label).whiteSpace,
        rowFits: row.scrollWidth <= row.clientWidth,
        labelHeight: label.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(getComputedStyle(label).lineHeight),
      };
    });
    expect(wrapMetrics.whiteSpace).toBe("normal");
    expect(wrapMetrics.rowFits).toBe(true);
    expect(wrapMetrics.labelHeight).toBeGreaterThan(wrapMetrics.lineHeight);
    await expect(changeRows.locator("[data-review-change-label]")).toHaveCount(
      3,
    );
    await expect(changed.locator("[data-review-see-change]")).toHaveText(
      "See changes (3)",
    );
    const question = page
      .locator(
        '[data-review-thread-state="sent"][data-review-outcome="question"]',
      )
      .first();
    if ((await question.getAttribute("data-review-thread-expanded")) === null) {
      await page
        .locator('[data-block-label="number"]')
        .scrollIntoViewIfNeeded();
      await question
        .locator("[data-review-thread-summary-toggle]")
        .evaluate((button) => button.click());
    }
    await expect(page.locator('[data-block-label="number"]')).toHaveAttribute(
      "data-review-anchor-changed",
      "",
    );
    await expect(question.locator("[data-review-anchor-context]")).toHaveCount(
      0,
    );

    await page
      .locator('[data-block-label="versionId"]')
      .scrollIntoViewIfNeeded();
    await changed
      .locator("[data-review-see-change]")
      .evaluate((button) => button.click());
    const lens = page.locator("[data-review-diff-lens]");
    const stepper = page.locator("[data-review-diff-stepper]");
    await expect(lens).toBeVisible();
    await expect(lens.locator('[data-review-diff-op="del"]')).toHaveCount(1);
    await expect(lens.locator('[data-review-diff-op="ins"]')).toHaveCount(1);
    await expect(lens.locator("[data-review-diff-comment-tag]")).toHaveCount(0);
    await expect(lens.locator("[data-review-diff-side]")).toHaveCount(2);
    await expect(lens.locator("[data-review-diff-side-label]")).toHaveText([
      "Was",
      "Now",
    ]);
    await expect(lens.locator("[data-review-diff-side-content]")).toHaveCount(
      2,
    );
    expect((await lens.boundingBox())?.height ?? 0).toBeLessThan(600);
    await expect(stepper.locator("[data-review-diff-position]")).toHaveText(
      "Change 1 of 3 · 1 · Details",
    );
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
        '[data-review-thread-state="sent"][data-review-outcome="changed"]',
      )
      .first();
    await expect(rehydratedChanged).toBeVisible();
    if (
      (await rehydratedChanged.getAttribute("data-review-thread-expanded")) ===
      null
    ) {
      await rehydratedChanged
        .locator("[data-review-thread-summary-toggle]")
        .click();
    }
    await rehydratedChanged.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(rehydratedChanged).toBeVisible();
  });

  await test.step("a second revision on the same block keeps both historical diffs pinned", async () => {
    const changed = page
      .locator(
        '[data-review-thread-state="sent"][data-review-outcome="changed"]',
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
        .locator("[data-review-thread-summary-toggle]")
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
    const replyPair = {
      fromRevision: deriveSourceRevision(current),
      toRevision: deriveSourceRevision(revised),
    };
    const replyChangeSet = buildRevisionChangeSet({
      pair: replyPair,
      before: renderDocument({
        markdown: current,
        fallbackTitle: "Review persistence",
        identity: {},
      }).blocks,
      after: renderDocument({
        markdown: revised,
        fallbackTitle: "Review persistence",
        identity: {},
      }).blocks,
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
              changes: replyChangeSet.places.map((place) => ({
                placeId: place.placeId,
                summary: "Made the stability guarantee explicit",
              })),
            },
          ],
        },
        request,
        commentsById: commentsFromExchange(exchange),
        changedPlaceIds: new Set(
          replyChangeSet.places.map((place) => place.placeId),
        ),
        fromRevision: replyPair.fromRevision,
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
      await restored.locator("[data-review-thread-summary-toggle]").click();
    }
    await expect(restored.locator("[data-review-see-change]")).toHaveCount(2);
    await expect(
      restored.locator("[data-review-see-change]").first(),
    ).toHaveText("See changes (3)");
    await expect(
      restored.locator("[data-review-see-change]").last(),
    ).toHaveText("See changes (2)");
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
    await expect(page.locator("[data-review-diff-lens]")).toBeHidden();
    await expect(
      page.locator("[data-review-diff-stepper] [data-review-diff-position]"),
    ).toHaveText("Change 1 of 3 · 1 · Details");
    await expect(page.locator("[data-review-diff-stepper]")).toBeVisible();
    await expect(page.locator("[data-review-diff-exit]")).toHaveText(
      "Show changes",
    );
    await page.locator("[data-review-diff-exit]").click();
    await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
    await page.locator("[data-review-diff-hide]").click();
    await restored
      .locator("[data-review-see-change]")
      .last()
      .evaluate((button) => button.click());
    await expect(
      page.locator('[data-review-diff-op="del"]').filter({ hasText: "Stable" }),
    ).toHaveCount(1);
    await expect(
      page
        .locator('[data-review-diff-op="ins"]')
        .filter({ hasText: "Immutable" }),
    ).toHaveCount(1);
    await page
      .locator("[data-review-diff-hide]")
      .evaluate((button) => button.click());
  });

  await test.step("responses collapse to one-line floating summaries without accumulating", async () => {
    const expanded = page.locator(
      "[data-review-thread-expanded] [data-review-thread-minimize]",
    );
    while ((await expanded.count()) > 0) {
      await expanded.first().evaluate((button) => button.click());
    }
    await expect(page.locator("[data-review-thread-summary]")).toHaveCount(3);
    const collapsedChanged = page
      .locator(
        '[data-review-thread-state="sent"][data-review-outcome="changed"]',
      )
      .first();
    const collapsedContainment = await collapsedChanged.evaluate((card) => {
      const originalWidth = card.style.width;
      card.style.width = "11rem";
      const echo = card.querySelector("[data-review-thread-echo]");
      const originalEcho = echo?.textContent ?? "";
      if (echo) {
        echo.textContent = "unbroken-collapsed-comment-token-".repeat(20);
      }
      const result = {
        card: card.scrollWidth <= card.clientWidth,
        summary: Array.from(
          card.querySelectorAll(
            "[data-review-thread-summary], [data-review-thread-summary-toggle], [data-review-thread-echo]",
          ),
        ).every(
          (node) =>
            node.scrollWidth <= node.clientWidth ||
            ["hidden", "clip"].includes(getComputedStyle(node).overflowX),
        ),
      };
      card.style.width = originalWidth;
      if (echo) echo.textContent = originalEcho;
      return result;
    });
    expect(collapsedContainment).toEqual({ card: true, summary: true });
    await expect(
      page.locator('[data-review-outcome-state="changed"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-review-outcome-state="question"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-review-outcome-state="outside"]'),
    ).toHaveCount(1);
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

  await test.step("composers and expanded threads never overlap neighboring controls", async () => {
    await page.setViewportSize({ width: 1440, height: 520 });
    await page
      .locator('[data-block-label="versionId"]')
      .scrollIntoViewIfNeeded();
    const summaries = page.locator("[data-review-thread-summary-toggle]");
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
    await page
      .locator("[data-review-thread-expanded] [data-review-thread-minimize]")
      .first()
      .click();

    await page.locator("[data-review-slide-selector]").last().click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
    await expect(compose).toHaveAttribute(
      "data-review-compose-placement",
      "floating",
    );
    const composeRect = await compose.boundingBox();
    const selectedSlideRect = await page
      .locator('[data-review-slide-highlight="active"] [data-slide-kicker]')
      .boundingBox();
    if (composeRect === null || selectedSlideRect === null) {
      throw new Error("The whole-slide composer has no document placement");
    }
    expect(composeRect.x).toBeGreaterThanOrEqual(
      selectedSlideRect.x + selectedSlideRect.width + 8,
    );
    const cardRectsAfterCompose = await page
      .locator("[data-review-thread-card]:not([hidden])")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        }),
      );
    for (const card of cardRectsAfterCompose) {
      expect(
        card.left < composeRect.x + composeRect.width &&
          card.right > composeRect.x &&
          card.top < composeRect.y + composeRect.height &&
          card.bottom > composeRect.y,
      ).toBe(false);
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
        '[data-review-thread-state="sent"][data-review-outcome="changed"] [data-review-thread-summary-toggle]',
      )
      .first();
    await expect(summary).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await expect(
        page.locator("[data-review-sent-list] [data-review-outcome-state]"),
      ).toHaveCount(0);
      await summary.hover();
      const hover = await summary
        .locator("[data-review-thread-echo]")
        .evaluate((node) => ({
          decoration: getComputedStyle(node).textDecorationLine,
          opacity: getComputedStyle(node).opacity,
        }));
      expect(hover.decoration).toContain("underline");
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
      const active = await summary
        .locator("[data-review-thread-echo]")
        .evaluate((node) => getComputedStyle(node).opacity);
      await page.mouse.move(1, 1);
      await page.mouse.up();
      expect(active).not.toBe(hover.opacity);
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
  });

  await test.step("a chip expands the complete thread in place and a reply stays in that chat", async () => {
    const questionCandidate = page
      .locator(
        '[data-review-thread-state="sent"][data-review-outcome="question"]',
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
      await question.locator("[data-review-thread-summary-toggle]").click();
    }
    await expect(question).toHaveAttribute("data-review-thread-expanded", "");
    await expect(
      question
        .locator("[data-review-thread-toolbar] [data-review-thread-minimize]")
        .first(),
    ).toBeVisible();
    await expect(
      question.locator('[data-review-thread-turn="user"]'),
    ).toHaveText(/Say whether numbering starts at one/);
    await expect(
      question.locator('[data-review-thread-turn="agent"]'),
    ).toContainText("Should numbering begin at zero or one?");
    const reply = question.locator("[data-review-thread-reply]");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await exerciseExpandedReplyRetention({
        owner: question,
        field: reply,
        expandedAttribute: "data-review-thread-expanded",
      });
    }
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
      { timeout: 10_000 },
    );
    await expect(status).toContainText("Blocked - no agent connected");
    await expect(status.locator("[data-review-spinner]")).toHaveCount(0);
    await expect(page.locator("[data-review-agent-state]")).toHaveText(
      "No agent connected",
    );
    await expect(
      question.locator('[data-review-outcome-state="blocked"]'),
    ).toHaveCount(0);
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
        changedPlaceIds: new Set(),
        fromRevision: effectiveSourceRevision({
          request,
          snapshot: exchange,
        }),
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
    await expect(page.locator("[data-review-round-summary]")).toBeEmpty();
    expect(
      await page
        .locator("[data-review-sent-list] [data-review-outcome-group] h3")
        .allTextContents(),
    ).toEqual(["Needs input 1", "Ready for Review 2"]);
    const needsInput = page.locator(
      '[data-review-outcome-group="needs-input"] [data-review-sent-row][data-review-outcome="question"]',
    );
    await expect(needsInput).toHaveAttribute(
      "data-review-row-state",
      "needs-input",
    );
    await expect(
      needsInput.locator("[data-review-row-secondary]"),
    ).toContainText("Needs your answer");
    await expect(
      page.locator(
        '[data-review-outcome-group="ready"] [data-review-sent-row][data-review-outcome="changed"] [data-review-row-review-change]',
      ),
    ).toHaveText("Review change");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      await exerciseControlStates({
        control: page.locator(
          '[data-review-outcome-group="ready"] [data-review-sent-row][data-review-outcome="changed"] [data-review-row-review-change]',
        ),
        property: "backgroundColor",
      });
    }
    for (const title of await page
      .locator("[data-review-sent-list] [data-review-row-target]")
      .allTextContents()) {
      expect(title).toMatch(/^\d+(?:\.\d+)? · (Details|Delivery)$/);
    }
    await page.setViewportSize({ width: 1440, height: 400 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => window.scrollY);
    await page
      .locator(
        '[data-review-outcome-group="ready"] [data-review-sent-row][data-review-outcome="outside"] [data-review-row-target]',
      )
      .click();
    await expect(tray).toBeVisible();
    await expect(page.locator("#delivery")).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .not.toBeCloseTo(before, 0);
    await expect(
      page.locator(
        '[data-review-sent-row][data-review-outcome="outside"][data-review-row-expanded]',
      ),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await test.step("a sent row transforms in place through both collapse controls in both themes", async () => {
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
    });
    const commentText = "Keep this delivery note in its own anchored thread.";
    const row = page.locator(
      '[data-review-sent-row][data-review-outcome="outside"]',
    );
    const target = row.locator("[data-review-row-target]");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      if ((await row.getAttribute("data-review-row-expanded")) !== null) {
        await target.click();
      }
      await expect(target).toHaveAttribute("aria-expanded", "false");
      await expect(row.locator("[data-review-row-body]")).toHaveText(
        commentText,
      );
      await expect(row.getByText(commentText, { exact: true })).toHaveCount(1);

      await page.mouse.move(1, 1);
      const resting = await target.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      await target.hover();
      const hover = await target.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      expect(hover).toBe(resting);
      await expect(row.locator("[data-review-row-locator]")).toHaveCSS(
        "opacity",
        "1",
      );
      const rowHover = await row.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      );
      expect(rowHover).not.toBe("rgba(0, 0, 0, 0)");
      await target.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
      await expect
        .poll(() => target.evaluate((node) => node.matches(":focus-visible")))
        .toBe(true);
      const box = await target.boundingBox();
      if (box === null) throw new Error("The thread header has no target");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const active = await target.evaluate(
        (node) => getComputedStyle(node).color,
      );
      await page.mouse.move(1, 1);
      await page.mouse.up();
      const restingColor = await target.evaluate(
        (node) => getComputedStyle(node).color,
      );
      expect(active).not.toBe(restingColor);

      await row.locator("[data-review-row-body]").click();
      await expect(row).toHaveAttribute("data-review-row-expanded", "");
      await expect(target).toHaveAttribute("aria-expanded", "true");
      await expect(row.locator("[data-review-row-body]")).toHaveCount(0);
      await expect(row.getByText(commentText, { exact: true })).toHaveCount(1);
      await expect(row.locator("[data-review-outcome-state]")).toHaveCount(0);
      await exerciseExpandedReplyRetention({
        owner: row,
        field: row.locator("[data-review-thread-reply]"),
        expandedAttribute: "data-review-row-expanded",
      });
      await page.waitForTimeout(700);
      const beforeCollapse = await page.evaluate(() => window.scrollY);
      await target.click();
      await expect(row).not.toHaveAttribute("data-review-row-expanded");
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeCloseTo(beforeCollapse, 0);
      await expect(row.locator("[data-review-row-body]")).toHaveText(
        commentText,
      );

      await target.click();
      await row.locator("[data-review-thread-minimize]").click();
      await expect(row).not.toHaveAttribute("data-review-row-expanded");
      await expect(row.locator("[data-review-row-body]")).toHaveText(
        commentText,
      );
    }
  });

  await test.step("plan-wide chat stays separate and reaches the same real agent exchange", async () => {
    await expect(tray).toBeVisible();
    await page.locator('[data-review-tab="chat"]').click();
    await expect(
      page.locator("[data-review-chat-empty] [data-review-status-setup]"),
    ).toHaveCount(0);
    await expect(page.locator("[data-review-chat-empty]")).toContainText(
      "Connection status and setup are in the Agent tab",
    );
    const sentCount = await page
      .locator("[data-review-thread-summary-toggle]")
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
    await expect(chatStatus).toContainText("Blocked - no agent connected");
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
    ).toContainText("Picked up: plan question", {
      timeout: 10_000,
    });
    await expect(chatStatus).toHaveAttribute(
      "data-review-thread-status",
      "working",
    );
    await expect(chatStatus.locator("[data-review-spinner]")).toHaveCount(2);
    const activityToggle = chatStatus.locator(
      "[data-review-status-activity-toggle]",
    );
    await expect(activityToggle).toHaveCount(0);
    await expect(
      chatStatus.locator("[data-review-status-current-activity]"),
    ).toContainText("Picked up: plan question");
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
        changedPlaceIds: new Set(),
        fromRevision: effectiveSourceRevision({
          request,
          snapshot: exchange,
        }),
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
    expect(chatDiff.diff.changeSet.places.length).toBeGreaterThan(0);
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
          .poll(
            () => button.evaluate((node) => node.matches(":focus-visible")),
            { message: `${control} exposes its keyboard focus state` },
          )
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
    if (chatPlaces > 1) {
      await page.locator("[data-review-diff-next]").click();
      await expect(page.locator("[data-review-diff-position]")).toContainText(
        `Change 2 of ${chatPlaces} ·`,
      );
      await page.locator("[data-review-diff-exit]").click();
      await expect(page.locator("[data-review-diff-lens]")).toBeHidden();
      await expect(page.locator("[data-review-diff-position]")).toContainText(
        `Change 2 of ${chatPlaces} ·`,
      );
      await page.locator("[data-review-diff-exit]").click();
      await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
      await expect(page.locator("[data-review-diff-position]")).toContainText(
        `Change 2 of ${chatPlaces} ·`,
      );
    }
    await digest.locator("[data-review-see-change]").click();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(page.locator("[data-review-diff-hidden]")).toHaveCount(0);

    const rewrittenRow = digest
      .locator("[data-review-change-row]")
      .filter({ hasText: "rewritten" })
      .first();
    await expect(rewrittenRow).toBeVisible();
    await rewrittenRow.click();
    await expect(page.locator('[data-review-diff-side="was"]')).toBeVisible();
    await expect(page.locator('[data-review-diff-side="now"]')).toBeVisible();
    await digest.locator("[data-review-see-change]").click();

    const addedRow = digest
      .locator("[data-review-change-row]")
      .filter({ hasText: "added" })
      .first();
    await addedRow.click();
    await expect(page.locator('[data-review-diff-side="was"]')).toHaveCount(0);
    await expect(page.locator('[data-review-diff-side="now"]')).toBeVisible();
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
        changedPlaceIds: new Set(),
        fromRevision: effectiveSourceRevision({
          request: formattingRequest,
          snapshot: formattingExchange,
        }),
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
        changedPlaceIds: new Set(),
        fromRevision: effectiveSourceRevision({
          request: unchangedRequest,
          snapshot: unchangedExchange,
        }),
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
        '[data-review-outcome-group="needs-input"] [data-review-sent-row][data-review-outcome="question"] [data-review-row-target]',
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
    await expect
      .poll(() =>
        inline.evaluate((node) => {
          const card = node.getBoundingClientRect();
          return {
            connected: node.isConnected,
            left: card.left,
            right: card.right,
            viewport: window.innerWidth,
            position: getComputedStyle(node).position,
          };
        }),
      )
      .toMatchObject({ connected: true, position: "relative" });
    const geometry = await inline.evaluate((node) => {
      const card = node.getBoundingClientRect();
      return {
        left: card.left,
        right: card.right,
        viewport: window.innerWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  });

  await test.step("Add Comment remembers immediate-send preference and staged comments can Send this", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    if (await tray.isVisible()) {
      await page.locator("[data-review-hide]").click();
    }
    const delivery = page.locator("[data-block-kind='paragraph']").last();
    await delivery.scrollIntoViewIfNeeded();
    await page.locator("[data-review-slide-selector]:visible").last().click();
    const preference = page.locator("[data-review-submit-immediately-input]");
    const preferenceTrack = page.locator("[data-review-switch-track]");
    await expect(preference).not.toBeChecked();
    await preferenceTrack.click();
    await expect(preference).toBeChecked();
    const activeTrackColors = await preferenceTrack.evaluate((track) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--diff-add-c)";
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return {
        actual: getComputedStyle(track).backgroundColor,
        expected,
      };
    });
    expect(activeTrackColors.actual).toBe(activeTrackColors.expected);
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
    await expect(preference).toBeChecked();
    await preferenceTrack.click();
    await expect(preference).not.toBeChecked();
    await page
      .locator("[data-review-compose-input]")
      .fill("Stage this one so Send this remains an explicit shortcut.");
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
      '[data-review-outcome-group="ready"] [data-review-sent-row][data-review-outcome="changed"] [data-review-row-target]',
    );
    await changedRow.click();
    const commentId = await changedRow
      .locator("xpath=ancestor::li[@data-review-comment-id]")
      .getAttribute("data-review-comment-id");
    if (commentId === null) throw new Error("Changed row has no comment id");
    const stableRow = page.locator(
      `[data-review-sent-row][data-review-comment-id="${commentId}"]`,
    );
    const trayThread = stableRow;
    const headerActions = trayThread.locator(
      ":scope > [data-review-row-head] [data-review-thread-toolbar-actions]",
    );
    await expect(trayThread).toHaveAttribute("data-review-row-expanded", "");
    await expect(
      headerActions.locator("[data-review-thread-revert]"),
    ).toBeVisible();
    await expect(
      headerActions.locator("[data-review-thread-resolve]"),
    ).toBeVisible();
    await expect(
      trayThread.locator("[data-review-thread-resolution]"),
    ).toHaveCount(0);
    const changeActions = trayThread.locator(
      "[data-review-thread-next-steps] [data-review-thread-toolbar-actions]",
    );
    await expect(
      trayThread.locator("[data-review-thread-next-steps]"),
    ).toContainText("Next steps");
    await expect(trayThread.locator("[data-review-see-change]")).toContainText(
      "See change",
    );
    await expect(
      changeActions.locator("[data-review-thread-minimize]"),
    ).toBeVisible();
    await expect(
      changeActions.locator("[data-review-thread-resolve]"),
    ).toBeVisible();
    await expect(
      changeActions.locator("[data-review-thread-revert]"),
    ).toBeVisible();
    await expect(
      trayThread.locator("[data-review-thread-reply-resolve]"),
    ).toHaveCount(0);
    await expect(
      trayThread.locator("[data-review-thread-reply-box] label"),
    ).toHaveCount(0);
    const replyField = trayThread.locator("[data-review-thread-reply]");
    await replyField.fill("One final note before resolving.");
    await expect(
      trayThread.locator("[data-review-thread-reply-send]"),
    ).toBeEnabled();
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
        const button = changeActions.locator(control);
        const styleProperty = "backgroundColor";
        await button.hover();
        await expect(
          button.locator("[data-review-icon-tooltip]"),
        ).toBeVisible();
        const hover = await button.evaluate(
          (node, property) => getComputedStyle(node)[property],
          styleProperty,
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
          (node, property) => getComputedStyle(node)[property],
          styleProperty,
        );
        await page.mouse.move(1, 1);
        await page.mouse.up();
        expect(active).not.toBe(hover);
      }
    }
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "light"),
    );
    const beforeMinimize = await page.evaluate(() => window.scrollY);
    await changeActions.locator("[data-review-thread-minimize]").click();
    await expect(trayThread).not.toHaveAttribute("data-review-row-expanded");
    await expect
      .poll(() =>
        page.evaluate(
          (before) => Math.abs(window.scrollY - before),
          beforeMinimize,
        ),
      )
      .toBeLessThanOrEqual(6);
    await changedRow.click();
    await expect(trayThread).toHaveAttribute("data-review-row-expanded", "");
    const historicalChange = trayThread
      .locator("[data-review-see-change]")
      .first();
    await historicalChange.click();
    await expect(historicalChange).toHaveText("Hide changes");
    await expect(page.locator("[data-review-diff-label]")).toContainText(
      "since revised again",
    );
    await headerActions.locator("[data-review-thread-minimize]").click();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(trayThread).not.toHaveAttribute("data-review-row-expanded");
    await expect(trayThread.locator("[data-review-row-body]")).toBeVisible();
    await expect(
      trayThread.locator("[data-review-thread-resolve]"),
    ).toHaveCount(0);
    await expect(trayThread.locator("[data-review-thread-revert]")).toHaveCount(
      0,
    );
    await expect(tray).toBeVisible();

    await changedRow.click();
    await expect(
      headerActions.locator("[data-review-thread-resolve]"),
    ).toBeVisible();
    await expect(
      headerActions.locator("[data-review-thread-revert]"),
    ).toBeVisible();
    await headerActions.locator("[data-review-thread-revert]").click();
    const revertDialog = page.locator("[data-review-revert-dialog]");
    await expect(revertDialog).toBeVisible();
    await expect(revertDialog).toContainText(
      "This reverses the plan changes owned by this comment",
    );
    await expect(revertDialog).toContainText("no new request is created");
    await page.locator("[data-review-revert-cancel]").click();
    await expect(revertDialog).toBeHidden();

    await headerActions.locator("[data-review-thread-revert]").click();
    const requestsBeforeRevert = (
      await readAgentExchange({
        store,
        sessionId: session.sessionId,
        planId: session.planId,
      })
    ).requests.length;
    const revertRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/revert") &&
        response.request().method() === "POST",
    );
    await page.locator("[data-review-revert-confirm]").click();
    const revertResponse = await revertRequest;
    if (!revertResponse.ok()) {
      const detail = (await revertResponse.json()) as { error?: string };
      throw new Error(
        `Local revert failed with HTTP ${revertResponse.status()}: ${detail.error ?? "unknown"}`,
      );
    }
    await expect
      .poll(async () => await readFile(session.plan, "utf8"))
      .toContain("Content hash of the snapshot");
    expect(
      (
        await readAgentExchange({
          store,
          sessionId: session.sessionId,
          planId: session.planId,
        })
      ).requests,
    ).toHaveLength(requestsBeforeRevert);
    await expect
      .poll(async () =>
        (await readProgress({ store, sessionId: session.sessionId })).some(
          (event) =>
            event.step === "Reviewer reverted a comment change" &&
            event.detail === commentId,
        ),
      )
      .toBe(true);
    await expect(
      page.locator('[data-block-label="versionId"]'),
    ).not.toHaveAttribute("data-review-anchor-changed");

    await expect(page.locator("[data-review-other-changes]")).toHaveCount(0);
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
    await expect(page.locator("[data-review-other-changes]")).toHaveCount(0);
    await expect(tray).toBeVisible();
  });

  await test.step("resolved threads stay retired after reload but remain findable", async () => {
    const restoreResolutionState = await page.evaluate(async () => {
      const token =
        document.documentElement.getAttribute("data-review-token") ?? "";
      const headers = {
        "content-type": "application/json",
        "x-big-plan-review-token": token,
      };
      const state = await fetch("/api/drafts", { headers }).then((response) =>
        response.json(),
      );
      await fetch("/api/drafts", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          drafts: state.drafts,
          activeDraft: state.activeDraft,
          resolvedCommentIds: state.sent.map(
            (comment: { readonly id: string }) => comment.id,
          ),
          expectedRevision: state.revision,
        }),
      });
      return {
        drafts: state.drafts,
        activeDraft: state.activeDraft,
        resolvedCommentIds: state.resolvedCommentIds,
      };
    });
    await page.reload();
    if (!(await tray.isVisible())) {
      await toggle.click();
    }
    await page.locator('[data-review-tab="comments"]').click();
    await expect(
      page.locator("[data-review-sent] [data-review-outcome-group]"),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.locator("[data-review-resolved-group]").evaluate((resolved) => ({
          border: getComputedStyle(resolved).borderTopWidth,
          hasFlushOverrides: ["mt-0!", "border-t-0!", "pt-0!"].every(
            (className) => resolved.classList.contains(className),
          ),
        })),
      )
      .toEqual({
        border: "0px",
        hasFlushOverrides: true,
      });
    await page.evaluate(async (state) => {
      const token =
        document.documentElement.getAttribute("data-review-token") ?? "";
      const headers = {
        "content-type": "application/json",
        "x-big-plan-review-token": token,
      };
      const current = await fetch("/api/drafts", { headers }).then((response) =>
        response.json(),
      );
      await fetch("/api/drafts", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ...state,
          expectedRevision: current.revision,
        }),
      });
    }, restoreResolutionState);
    await page.reload();
    if (!(await tray.isVisible())) {
      await toggle.click();
    }
    await page.locator('[data-review-tab="comments"]').click();
    await expect(
      page.locator("[data-review-resolved-group] summary"),
    ).toHaveText("Resolved (1)");
    await expect(page.locator("[data-review-empty]")).toBeVisible();
    await expect
      .poll(() =>
        page.locator("[data-review-sent]").evaluate((sent) => {
          const resolved = sent.querySelector("[data-review-resolved-group]");
          return {
            outer: getComputedStyle(sent).borderTopWidth,
            inner:
              resolved === null
                ? "missing"
                : getComputedStyle(resolved).borderTopWidth,
          };
        }),
      )
      .toEqual({
        outer: "1px",
        inner: "1px",
      });
    await page.locator("[data-review-resolved-group] summary").click();
    const resolvedRow = page.locator("[data-review-resolved-group] li");
    await expect(resolvedRow).toHaveCount(1);
    await resolvedRow.locator("[data-review-row-target]").click();
    await expect(resolvedRow).toHaveAttribute("data-review-row-expanded", "");
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
        '[data-review-outcome-group="ready"] [data-review-sent-row][data-review-outcome="changed"]',
      ),
    ).toHaveCount(1);
    const restoredRow = page.locator(
      '[data-review-outcome-group="ready"] [data-review-sent-row][data-review-outcome="changed"]',
    );
    if ((await restoredRow.getAttribute("data-review-row-expanded")) === null) {
      await restoredRow.locator("[data-review-row-target]").click();
    }
    await restoredRow.locator("[data-review-see-change]").first().click();
    await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
    const savedReresolve = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await restoredRow
      .locator(":scope > [data-review-row-head] [data-review-thread-resolve]")
      .click();
    expect((await savedReresolve).ok()).toBe(true);
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(page.locator("[data-review-resolved-group]")).toHaveCount(1);
  });

  await test.step("staged selection anchors silently re-find exact quotes and degrade when the quote disappears", async () => {
    if (await tray.isVisible()) {
      await page.locator("[data-review-hide]").click();
    }
    const paragraph = page.locator(
      '[data-block-id="section/delivery/paragraph-1"]',
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
      page.locator('[data-block-id="section/delivery/paragraph-1"]'),
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
      page.locator('[data-block-id="section/delivery/paragraph-1"]'),
    ).toHaveAttribute("data-review-anchor-changed", "");
  });
});

test("should keep composition anchored across tray and missing-source states", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(reviewRuntimeUrl);
  await expect(page.locator("html")).toHaveAttribute("data-review-ready", "");
  const toggle = page.locator("[data-review-toggle]");
  const compose = page.locator("[data-review-compose]");
  const paragraph = page.locator("[data-block-kind='paragraph']").first();

  await toggle.click();
  await paragraph.evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.locator("[data-review-affordance]").click();
  await expect(compose).toHaveAttribute("data-review-compose-inline", "");
  await expect
    .poll(() =>
      compose.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.top > 0 && rect.left > 0 && getComputedStyle(node).position;
      }),
    )
    .toBe("relative");

  await page.locator("[data-review-hide]").click();
  await expect(compose).toHaveAttribute(
    "data-review-compose-placement",
    "floating",
  );
  await toggle.click();
  await expect(compose).toHaveAttribute("data-review-compose-inline", "");

  await paragraph.evaluate((node) => {
    node.remove();
    window.dispatchEvent(new Event("resize"));
  });
  await expect(compose).toHaveAttribute(
    "data-review-compose-placement",
    "centered",
  );
  await expect
    .poll(() =>
      compose.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          position: getComputedStyle(node).position,
          centeredX: Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2,
          centeredY: Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 2,
          stranded: rect.left === 0 && rect.top === 0,
        };
      }),
    )
    .toEqual({
      position: "fixed",
      centeredX: true,
      centeredY: true,
      stranded: false,
    });
});

test("should present one live agent activity and navigate to its conversation", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(reviewRuntimeUrl);
  await expect(page.locator("html")).toHaveAttribute("data-review-ready", "");
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
    throw new Error("The activity test needs the live session identity");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "waiting",
  });

  await page.locator("[data-review-toggle]").click();
  await page.locator('[data-review-tab="agent"]').click();
  const activity = page.locator("[data-review-current-activity]");
  await expect(activity).toHaveAttribute(
    "data-review-current-activity",
    "idle",
  );
  await expect(activity).toContainText("No agent work in progress");
  await expect(activity).toContainText(
    "The agent is connected and waiting for feedback.",
  );

  await page.locator('[data-review-tab="comments"]').click();
  await page.locator("[data-review-slide-selector]").first().click();
  await page
    .locator("[data-review-compose-input]")
    .fill("Restore the three Spanish sentences to English.");
  await page.locator("[data-review-compose-save]").click();
  await page.locator("[data-review-sidebar-send]").click();
  await expect(page.locator("[data-review-sent-row]")).toHaveCount(1);
  await page.locator('[data-review-tab="agent"]').click();
  await expect(activity).toHaveAttribute(
    "data-review-current-activity",
    "waiting",
  );
  await expect(activity).toContainText("Waiting for agent");

  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const pending = nextPendingAgentRequest(exchange);
  if (pending === undefined) {
    throw new Error("The activity test did not queue its feedback request");
  }
  await writeAgentClaim({
    store,
    request: {
      ...pending,
      claimedFromRevision: pending.sourceRevision,
    },
  });
  await appendProgress({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: pending.requestId,
      step: "Reading the request",
      state: "live",
      at: new Date(Date.now() - 1_000).toISOString(),
    },
  });
  await appendProgress({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: pending.requestId,
      step: "Restoring the Spanish sentences to English",
      state: "live",
      at: new Date().toISOString(),
    },
  });

  await expect(activity).toHaveAttribute(
    "data-review-current-activity",
    "working",
    { timeout: 10_000 },
  );
  await expect(activity).toContainText("Responding to a comment");
  await expect(activity).toContainText(
    "Restoring the Spanish sentences to English",
  );
  await expect(activity).not.toContainText("Reading the request");

  const history = page.locator("[data-review-connection-history]");
  await history.locator("summary").click();
  await expect(history).toHaveAttribute("open", "");
  await appendProgress({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: pending.requestId,
      step: "Validating the restored plan",
      state: "live",
      at: new Date(Date.now() + 1).toISOString(),
    },
  });
  await expect(activity).toContainText("Validating the restored plan", {
    timeout: 10_000,
  });
  await expect(history).toHaveAttribute("open", "");

  await page.locator("[data-review-current-activity-view]").click();
  await expect(page.locator('[data-review-tab="comments"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("[data-review-row-expanded]")).toHaveCount(1);
});

test("should preserve footnote navigation inside a selected slide", async ({
  page,
  footnoteReviewRuntimeUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(footnoteReviewRuntimeUrl);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
  });
  const selector = page.locator("[data-review-slide-selector]").first();
  const selectedSlide = selector.locator("xpath=ancestor::*[@data-slide]");
  await selector.click();
  const compose = page.locator("[data-review-compose]");
  await expect(compose).toHaveAttribute(
    "data-review-compose-placement",
    "floating",
  );
  await page
    .locator("[data-review-compose-input]")
    .fill("Keep the footnote reachable while this slide is selected.");
  await page.locator("[data-review-compose-save]").click();
  await expect(selectedSlide).toHaveAttribute(
    "data-review-slide-highlight",
    "comment",
  );
  const wholeSlideCard = page
    .locator("[data-review-thread-card]:not([hidden])")
    .first();
  await expect(wholeSlideCard).toBeVisible();
  await expect
    .poll(async () => {
      const cardRect = await wholeSlideCard.boundingBox();
      const anchorRect = await selectedSlide
        .locator("[data-slide-kicker]")
        .boundingBox();
      return (
        cardRect !== null &&
        anchorRect !== null &&
        cardRect.x >= anchorRect.x + anchorRect.width + 8
      );
    })
    .toBe(true);
  const footnoteLink = selectedSlide.locator("[data-footnote-ref]");
  const footnote = page.locator("#user-content-fn-delivery");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (nextTheme) =>
        document.documentElement.setAttribute("data-theme", nextTheme),
      theme,
    );
    await footnoteLink.click();
    await expect(footnote).toBeInViewport();
    await expect
      .poll(() => page.evaluate(() => location.hash))
      .toBe("#user-content-fn-delivery");
    await footnote.locator("[data-footnote-backref]").click();
    await expect(footnoteLink).toBeInViewport();
  }
  const footnoteParagraph = footnoteLink.locator("xpath=ancestor::p");
  await footnoteParagraph.click({ clickCount: 3 });
  const affordance = page.locator("[data-review-affordance]");
  await expect(affordance).toBeVisible();
  await affordance.click();
  await expect(compose).toBeVisible();
  await expect
    .poll(() =>
      compose.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > 44 && rect.top < window.innerHeight;
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
});

test("should preserve stale-tab text when a reviewer save conflicts", async ({
  page,
  reviewRuntimeUrl,
}) => {
  const staleTab = await page.context().newPage();
  await staleTab.goto(reviewRuntimeUrl);
  await expect(staleTab.locator("html")).toHaveAttribute(
    "data-review-ready",
    "",
  );
  await page.goto(reviewRuntimeUrl);
  await expect(page.locator("html")).toHaveAttribute("data-review-ready", "");

  const paragraph = staleTab.locator(
    '[data-block-id="section/delivery/paragraph-1"]',
  );
  await paragraph.evaluate((block) => {
    const range = document.createRange();
    range.selectNodeContents(block);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await staleTab.locator("[data-review-affordance]").click();
  const body = "Preserve this exact stale-tab reviewer text.";
  await staleTab.locator("[data-review-compose-input]").fill(body);
  const conflictedSave = staleTab.waitForResponse(
    (response) =>
      response.url().endsWith("/api/drafts") &&
      response.request().method() === "PUT" &&
      response.status() === 409,
  );
  await staleTab.locator("[data-review-compose-save]").click();
  await conflictedSave;

  await expect(staleTab.locator("[data-review-toast]")).toContainText(
    "Review changed in another tab",
  );
  await expect(
    staleTab.locator("[data-review-drafts] li").filter({ hasText: body }),
  ).toHaveCount(1);
  const beforeReload = await staleTab.evaluate(async (draftBody) => {
    const token =
      document.documentElement.getAttribute("data-review-token") ?? "";
    const state = await fetch("/api/drafts", {
      headers: { "x-big-plan-review-token": token },
    }).then((response) => response.json());
    return state.drafts.some(
      (draft: { readonly body?: string }) => draft.body === draftBody,
    );
  }, body);
  expect(beforeReload).toBe(false);

  await staleTab.reload();
  await expect(staleTab.locator("html")).toHaveAttribute(
    "data-review-ready",
    "",
  );
  await expect
    .poll(() =>
      staleTab.evaluate(async (draftBody) => {
        const token =
          document.documentElement.getAttribute("data-review-token") ?? "";
        const state = await fetch("/api/drafts", {
          headers: { "x-big-plan-review-token": token },
        }).then((response) => response.json());
        return state.drafts.some(
          (draft: { readonly body?: string }) => draft.body === draftBody,
        );
      }, body),
    )
    .toBe(true);
  await staleTab.close();
});
