// Critical browser journey for the live `big-plan review` surface: state
// restores before its first interactive paint, the narrow tray is reachable
// without moving the plan, concrete row targets remain distinguishable,
// keyboard and shortcut contracts agree, semantic outcomes keep their tones,
// and Send writes the real feedback package the CLI promises.

import { readFile, stat } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("should preserve and send a real review across reload and viewport changes", async ({
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
  const affordance = page.locator("[data-review-affordance]");

  await test.step("adjacent rows keep concrete labels in the tray", async () => {
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
      const compose = page.locator("[data-review-compose]");
      await expect(compose).toHaveAttribute("data-review-compose-inline", "");
      await expect
        .poll(() =>
          compose.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const targets = Array.from(
              document.querySelectorAll("[data-block-id]"),
            ).filter((candidate) => candidate !== node.previousElementSibling);
            return targets.some((target) => {
              const other = target.getBoundingClientRect();
              return (
                box.left < other.right &&
                box.right > other.left &&
                box.top < other.bottom &&
                box.bottom > other.top
              );
            });
          }),
        )
        .toBe(false);
      await page.locator("[data-review-compose-input]").fill(body);
      await page.locator("[data-review-compose-save]").click();
    }
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(2);
    const labels = await page
      .locator("[data-review-row-target]")
      .allTextContents();
    expect(labels).toEqual([
      "Details / versionId · Table row",
      "Details / number · Table row",
    ]);
  });

  await test.step("the active whole-plan field restores before first paint", async () => {
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
    await expect(page.locator("[data-review-marker]")).toHaveCount(
      await page.locator("[data-block-id]").count(),
    );
    await expect(
      page.locator("[data-review-marker][data-review-marker-active]"),
    ).toHaveCount(2);
  });

  await test.step("every textarea context has a visible keyboard focus ring", async () => {
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

  await test.step("the below-1280 drawer is reachable and reversible in place", async () => {
    await page.locator("[data-review-hide]").click();
    await page.locator("#delivery").scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1024, height: 900 });
    const before = await page.evaluate(() => window.scrollY);
    await page.locator("[data-review-toggle]").click();
    await expect(tray).toBeVisible();
    await expect(page.locator("[data-review-backdrop]")).toBeVisible();
    const geometry = await tray.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(before, 0);
    await page.locator("[data-review-backdrop]").click();
    await expect(tray).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeCloseTo(before, 0);
  });

  await test.step("Ctrl+Enter cannot bypass empty-comment validation", async () => {
    const before = await page.locator("[data-review-drafts] li").count();
    await page.locator("[data-block-kind='heading']").first().hover();
    await affordance.click();
    await expect(page.locator("[data-review-compose-save]")).toBeDisabled();
    await page.locator("[data-review-compose-input]").press("Control+Enter");
    await expect(page.locator("[data-review-compose]")).toBeVisible();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(before);
    await page.locator("[data-review-compose-cancel]").click();
  });

  await test.step("outcome labels and borders share semantic tones in both themes", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("[data-review-toggle]").click();
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

  await test.step("Send writes the real package and submitted state also restores", async () => {
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
