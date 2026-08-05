// Browser test of the reviewer's commenting journey over a complete rendered
// document: the quiet reading default, a whole-slide selection, a comment on a
// highlighted passage, the Feedback sidebar's staged lifecycle, and the guarantee
// that a comment body stays literal text wherever it is shown. The runtime's
// transport and package behavior is covered by its own unit tests; this spec
// covers the half that only exists in a browser. Render-health failures are
// enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should comment on a slide and a passage, then revise before sending", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  const tray = page.locator("[data-review-rail]");
  const affordance = page.locator("[data-review-affordance]");
  const rows = page.locator("[data-review-drafts] li");
  let initialSelectorGap = 0;

  await test.step("reading stays quiet until the reviewer asks for more", async () => {
    await expect(tray).toBeHidden();
    await expect(affordance).toBeHidden();
    await expect(page.locator("[data-review-toggle]")).toBeVisible();
    await expect(page.locator("[data-review-annotated]")).toHaveCount(0);
  });

  await test.step("hovering a block stays quiet while a slide selector teaches selection", async () => {
    await page.locator("[data-block-kind='list']").first().hover();
    await expect(affordance).toBeHidden();
    const selector = page.locator("[data-review-slide-selector]").first();
    await expect(selector).toBeVisible();
    const geometry = await selector.evaluate((node) => {
      const slide = node.closest("[data-slide]");
      if (slide === null) return null;
      const slideRect = slide.getBoundingClientRect();
      const selectorRect = node.getBoundingClientRect();
      const kickerRect = slide
        .querySelector("[data-slide-kicker]")
        ?.getBoundingClientRect();
      const toggleRect = slide
        .querySelector(
          ":scope > [data-collapse-header] > [data-collapse-toggle]",
        )
        ?.getBoundingClientRect();
      return {
        gap: slideRect.left - selectorRect.right,
        gapToKicker:
          kickerRect === undefined ? -1 : kickerRect.left - selectorRect.right,
        overlapsToggle:
          toggleRect !== undefined &&
          selectorRect.left < toggleRect.right &&
          selectorRect.right > toggleRect.left &&
          selectorRect.top < toggleRect.bottom &&
          selectorRect.bottom > toggleRect.top,
        topDelta: selectorRect.top - slideRect.top,
      };
    });
    if (geometry === null) {
      throw new Error("The slide selector is not anchored to a slide");
    }
    initialSelectorGap = geometry.gap;
    expect(geometry.gapToKicker).toBeGreaterThanOrEqual(0);
    expect(geometry.gapToKicker).toBeLessThanOrEqual(8);
    expect(geometry.overlapsToggle).toBe(false);
    expect(geometry.topDelta).toBeGreaterThanOrEqual(5);
    expect(geometry.topDelta).toBeLessThanOrEqual(8);
    await expect(selector).toHaveAttribute(
      "aria-label",
      "Comment on all content in Status quo",
    );
    await selector.click();
    await expect(page.locator("[data-review-compose]")).toBeVisible();
    await expect(affordance).toBeHidden();
  });

  await test.step("saving the first comment floats its card and chips the block", async () => {
    await page
      .locator("[data-review-compose-input]")
      .fill("Say what breaks, not only what works.");
    await page.locator("[data-review-compose-save]").click();
    await expect(tray).toBeHidden();
    await expect(page.locator("[data-review-thread-card]")).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-review-annotated]")).toHaveCount(1);
    await expect(page.locator("[data-review-toggle-count]")).toHaveText("1");
    const geometry = await page
      .locator("[data-review-slide-selector]")
      .first()
      .evaluate((node) => {
        const slide = node.closest("[data-slide]");
        if (slide === null) return null;
        const slideRect = slide.getBoundingClientRect();
        const selectorRect = node.getBoundingClientRect();
        const kickerRect = slide
          .querySelector("[data-slide-kicker]")
          ?.getBoundingClientRect();
        const toggleRect = slide
          .querySelector(
            ":scope > [data-collapse-header] > [data-collapse-toggle]",
          )
          ?.getBoundingClientRect();
        return {
          gap: slideRect.left - selectorRect.right,
          gapToKicker:
            kickerRect === undefined
              ? -1
              : kickerRect.left - selectorRect.right,
          overlapsToggle:
            toggleRect !== undefined &&
            selectorRect.left < toggleRect.right &&
            selectorRect.right > toggleRect.left &&
            selectorRect.top < toggleRect.bottom &&
            selectorRect.bottom > toggleRect.top,
          topDelta: selectorRect.top - slideRect.top,
        };
      });
    if (geometry === null) {
      throw new Error("The slide selector lost its slide anchor");
    }
    expect(geometry.gap).toBeCloseTo(initialSelectorGap, 1);
    expect(geometry.gapToKicker).toBeGreaterThanOrEqual(0);
    expect(geometry.gapToKicker).toBeLessThanOrEqual(8);
    expect(geometry.overlapsToggle).toBe(false);
    expect(geometry.topDelta).toBeGreaterThanOrEqual(5);
    expect(geometry.topDelta).toBeLessThanOrEqual(8);
  });

  await test.step("highlighting a passage offers to comment on the selection", async () => {
    await page.evaluate(() => {
      const paragraph = document.querySelector("[data-block-kind='paragraph']");
      const target = paragraph?.firstChild;
      if (target === null || target === undefined) return;
      const range = document.createRange();
      range.setStart(target, 0);
      range.setEnd(target, 8);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(page.locator("[data-review-compose-target]")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "true",
    );
  });

  await test.step("a comment body stays literal text wherever it is shown", async () => {
    await page
      .locator("[data-review-compose-input]")
      .fill("<img src=x onerror=alert(1)> ## Not a heading");
    await page.locator("[data-review-compose-save]").click();
    const body = page.locator("[data-review-row-body]").nth(1);
    await expect(body).toHaveText(
      "<img src=x onerror=alert(1)> ## Not a heading",
    );
    expect(await body.locator("*").count()).toBe(0);
  });

  await test.step("a pending comment can be rewritten in place", async () => {
    await page.locator("[data-review-toggle]").click();
    await page.locator("[data-review-row-edit]").first().click();
    await page
      .locator("[data-review-row-input]")
      .fill("Rewritten before send.");
    await page.locator("[data-review-row-save]").click();
    await expect(page.locator("[data-review-row-body]").first()).toHaveText(
      "Rewritten before send.",
    );
  });

  await test.step("deleting the last comment on a block clears its chip", async () => {
    await page.locator("[data-review-row-delete]").first().click();
    await expect(page.locator("[data-review-delete-dialog]")).toBeVisible();
    await page.locator("[data-review-delete-confirm]").click();
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-review-annotated]")).toHaveCount(1);
  });

  await test.step("the tray hides on demand while preserving the staged count", async () => {
    await page.locator("[data-review-hide]").click();
    await expect(tray).toBeHidden();
    await expect(page.locator("[data-review-toggle-count]")).toHaveText("1");
    await page.locator("[data-review-toggle]").click();
    await expect(tray).toBeVisible();
  });

  await test.step("submitting without a runtime says so instead of failing silently", async () => {
    await page.locator("[data-review-send]").click();
    await expect(page.locator("[data-review-send-note]")).toContainText(
      "big-plan review",
    );
    await expect(rows).toHaveCount(1);
  });
});

test("should offer comments from nested sub-slide icons and text selections", async ({
  page,
  deckViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(deckViewerUrl);
  const subSlide = page.locator("[data-subslide]").first();
  const selector = subSlide.locator(":scope > [data-review-slide-selector]");
  const compose = page.locator("[data-review-compose]");
  const affordance = page.locator("[data-review-affordance]");

  await test.step("the nested selector keeps complete interaction states in both themes", async () => {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await selector.hover();
      await expect
        .poll(() => selector.evaluate((node) => node.matches(":hover")))
        .toBe(true);

      await selector.focus();
      const focusState = await selector.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          focused: node.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      expect(focusState.focused).toBe(true);
      expect(focusState.outlineStyle).not.toBe("none");
      expect(focusState.outlineWidth).not.toBe("0px");

      const box = await selector.boundingBox();
      if (box === null) throw new Error("The nested selector has no hit box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect
        .poll(() => selector.evaluate((node) => node.matches(":active")))
        .toBe(true);
      await page.mouse.up();
    }
  });

  await test.step("the nested selector owns an addressable sub-slide", async () => {
    await expect(subSlide.locator("[data-block-id]")).not.toHaveCount(0);
    await expect(selector).toBeVisible();
    const geometry = await selector.evaluate((node) => {
      const slide = node.closest("[data-slide]");
      if (slide === null) return null;
      const slideRect = slide.getBoundingClientRect();
      const selectorRect = node.getBoundingClientRect();
      const kickerRect = slide
        .querySelector("[data-slide-kicker]")
        ?.getBoundingClientRect();
      const toggleRect = slide
        .querySelector(
          ":scope > [data-collapse-header] > [data-collapse-toggle]",
        )
        ?.getBoundingClientRect();
      return {
        gap: slideRect.left - selectorRect.right,
        gapToKicker:
          kickerRect === undefined ? -1 : kickerRect.left - selectorRect.right,
        overlapsToggle:
          toggleRect !== undefined &&
          selectorRect.left < toggleRect.right &&
          selectorRect.right > toggleRect.left &&
          selectorRect.top < toggleRect.bottom &&
          selectorRect.bottom > toggleRect.top,
        topDelta: selectorRect.top - slideRect.top,
      };
    });
    expect(geometry?.gapToKicker).toBeGreaterThanOrEqual(0);
    expect(geometry?.gapToKicker).toBeLessThanOrEqual(8);
    expect(geometry?.overlapsToggle).toBe(false);
    expect(geometry?.topDelta).toBeGreaterThanOrEqual(5);
    expect(geometry?.topDelta).toBeLessThanOrEqual(8);
    await selector.scrollIntoViewIfNeeded();
    const before = await subSlide.evaluate((slide) => {
      const title = document.querySelector("h1");
      const article = document.querySelector("article");
      const slideRect = slide.getBoundingClientRect();
      return {
        articleLeft: article?.getBoundingClientRect().left ?? -1,
        bodyPaddingRight: getComputedStyle(document.body).paddingRight,
        scrollY: window.scrollY,
        slideLeft: slideRect.left,
        slideTop: slideRect.top,
        titleLeft: title?.getBoundingClientRect().left ?? -1,
      };
    });
    await selector.click();
    await expect(compose).toBeVisible();
    await expect(compose).toHaveAttribute(
      "data-review-compose-placement",
      "floating",
    );
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-review-floating",
    );
    await expect
      .poll(() =>
        subSlide.evaluate((slide) => {
          const title = document.querySelector("h1");
          const article = document.querySelector("article");
          const slideRect = slide.getBoundingClientRect();
          return {
            articleLeft: article?.getBoundingClientRect().left ?? -1,
            bodyPaddingRight: getComputedStyle(document.body).paddingRight,
            scrollY: window.scrollY,
            slideLeft: slideRect.left,
            slideTop: slideRect.top,
            titleLeft: title?.getBoundingClientRect().left ?? -1,
          };
        }),
      )
      .toEqual(before);
    await expect(subSlide).toHaveAttribute(
      "data-review-slide-highlight",
      "active",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("selected sub-slide text exposes the comment affordance", async () => {
    const target = subSlide.locator("[data-block-kind='list'] li").first();
    await target.evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text !== null && (text.textContent?.trim().length ?? 0) === 0) {
        text = walker.nextNode();
      }
      if (text === null) throw new Error("The nested block has no text");
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, Math.min(12, text.textContent?.length ?? 0));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(compose).toBeVisible();
  });
});
