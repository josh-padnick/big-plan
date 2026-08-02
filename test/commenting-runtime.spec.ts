// Critical browser journey for the live `big-plan review` surface: the
// Notion-style source highlight, floating composer and comment cards, staged
// lifecycle, confirmed deletion, persistence, responsive fallback, and real
// feedback package all work together without losing the reader's position.

import { readFile, stat } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("should preserve and send a floating review across reload and viewport changes", async ({
  page,
  reviewRuntimeUrl,
}) => {
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
  });

  await test.step("the hover Comment control dismisses when its trigger is left", async () => {
    await page.locator("[data-block-kind='paragraph']").first().hover();
    await expect(affordance).toBeVisible();
    await toggle.hover();
    await expect(affordance).toBeHidden();
  });

  await test.step("a whole-paragraph selection always offers the same floating composer", async () => {
    const paragraph = page.locator("[data-block-kind='paragraph']").first();
    await paragraph.click({ clickCount: 3 });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(compose).toHaveAttribute("data-review-compose-floating", "");
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
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewport);

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

  await test.step("right-hand Comment buttons select their blocks and enter the same flow", async () => {
    for (const [label, body] of [
      ["versionId", "Explain why the content hash is stable."],
      ["number", "Say whether numbering starts at one."],
    ]) {
      const row = page.locator(`[data-block-label="${label}"]`);
      await row.hover();
      await expect(affordance).toHaveAttribute(
        "aria-label",
        new RegExp(`${label}$`),
      );
      await affordance.click();
      await expect(compose).toHaveAttribute("data-review-compose-floating", "");
      await expect(row).toHaveAttribute("data-review-active-highlight", "");
      await page.locator("[data-review-compose-input]").fill(body);
      await page.locator("[data-review-compose-save]").click();
    }
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(2);
    await expect(
      page.locator('[data-review-comment-state="staged"]'),
    ).toHaveCount(4);
    await expect(page.locator("[data-review-thread-card]")).toHaveCount(2);
  });

  await test.step("the sidebar has a top edge and complete clickable staged lifecycle", async () => {
    await toggle.click();
    await expect(tray).toBeVisible();
    await expect
      .poll(() =>
        tray.evaluate((node) => getComputedStyle(node).borderTopWidth),
      )
      .toBe("1px");
    const titles = page.locator(
      "[data-review-drafts] [data-review-row-target]",
    );
    await expect(titles).toHaveCount(2);
    expect(await titles.allTextContents()).toEqual(["Details", "Details"]);
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
    await expect(page.locator('[data-review-tab="chat"]')).toContainText(
      "Simulated",
    );
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

  await test.step("Ctrl+Enter cannot bypass empty-comment validation", async () => {
    const before = await page.locator("[data-review-drafts] li").count();
    const heading = page.locator("[data-block-kind='heading']").last();
    await heading.hover();
    await affordance.click();
    await expect(page.locator("[data-review-compose-save]")).toBeDisabled();
    await page.locator("[data-review-compose-input]").press("Control+Enter");
    await expect(compose).toBeVisible();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(before);
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("outcome labels and borders share semantic tones in both themes", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await toggle.click();
    await page.locator('[data-review-tab="chat"]').click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (nextTheme) =>
          document.documentElement.setAttribute("data-theme", nextTheme),
        theme,
      );
      for (const outcome of ["changed", "question", "declined"]) {
        const card = page.locator(`[data-review-outcome="${outcome}"]`);
        const colors = await card.evaluate((node) => {
          const label = node.querySelector("[data-review-outcome-state]");
          return {
            border: getComputedStyle(node).borderLeftColor,
            label: label === null ? "" : getComputedStyle(label).color,
          };
        });
        expect(colors.label).toBe(colors.border);
      }
    }
  });

  await test.step("Send writes the real package and the sent lifecycle also restores", async () => {
    await page.locator('[data-review-tab="comments"]').click();
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

    await page.locator('[data-review-tab="comments"]').click();
    await expect(
      page.locator(
        '[data-review-sent-list] [data-review-comment-state="sent"]',
      ),
    ).toHaveCount(2);
    expect(
      await page
        .locator("[data-review-sent-list] [data-review-row-target]")
        .allTextContents(),
    ).toEqual(["Details", "Details"]);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-active-draft",
      "Unsaved reload draft must survive.",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-draft-count",
      "0",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-test-first-sent-count",
      "2",
    );
  });
});
