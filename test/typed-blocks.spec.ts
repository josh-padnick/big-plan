// Browser tests of the typed blocks: callout variants and the CodeDiff views,
// line annotations, actions menu, clipboard behavior, and full-screen dialog,
// plus the no-JavaScript fallback. Render-health failures are enforced by fixtures.

import { expect, test } from "./fixtures";

const RAW_GIT_DIFF = [
  "diff --git a/src/catalog/read-through-cache.ts b/src/catalog/read-through-cache.ts",
  "index 23ad911..890ce42 100644",
  "--- a/src/catalog/read-through-cache.ts",
  "+++ b/src/catalog/read-through-cache.ts",
  "@@ -18,5 +18,8 @@ export const readCatalog = async (key: string) => {",
  "   const cached = await cache.get(key);",
  "-  if (cached !== null && cached.ageSeconds <= 60) {",
  "+  if (cached !== null && cached.ageSeconds <= 150) {",
  "+    if (cached.ageSeconds > 60) {",
  "+      await refreshQueue.enqueueOnce(key);",
  "+    }",
  "     return cached.value;",
  "   }",
  // The example's blank context line is whitespace-stripped on disk. Copy
  // reproduces the fence content as MDX normalizes it: LF line endings with
  // a trailing newline, not the authored bytes.
  "",
  "@@ -31,4 +34,5 @@ export const readCatalog = async (key: string) => {",
  "   const value = await catalogOrigin.read(key);",
  "   await cache.put(key, value, { ttlSeconds: 300 });",
  "+  metrics.increment(\"catalog_cache.origin_fallback\");",
  "   return value;",
  " };",
  "",
].join("\n");


test("should distinguish every callout type when the typed-block plan renders", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const calloutTypes = ["note", "tip", "warning", "danger"];
  for (const type of calloutTypes) {
    await expect(page.locator(`[data-callout="${type}"]`)).toBeVisible();
  }
  const accents = await page.locator("[data-callout]").evaluateAll((callouts) =>
    callouts.map((callout) => getComputedStyle(callout).borderLeftColor),
  );
  expect(new Set(accents).size).toBe(calloutTypes.length);
});

test("should remember the selected diff view when the page reloads", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const unified = diff.locator('[data-diff-content="unified"]');
  const split = diff.locator('[data-diff-content="split"]');
  const unifiedButton = diff.getByRole("button", { name: "Unified view" });
  const splitButton = diff.getByRole("button", { name: "Side-by-side view" });
  await expect(unified).toBeVisible();
  await expect(split).toBeHidden();
  await expect(unifiedButton).toHaveAttribute("aria-pressed", "true");
  await expect(splitButton).toHaveAttribute("aria-pressed", "false");

  await splitButton.click();

  await expect(diff).toHaveAttribute("data-diff-view", "split");
  await expect(unified).toBeHidden();
  await expect(split).toBeVisible();
  await expect(splitButton).toHaveAttribute("aria-pressed", "true");
  await expect(unifiedButton).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(diff).toHaveAttribute("data-diff-view", "split");
  await expect(diff.getByRole("button", { name: "Side-by-side view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("should keep a range Annotation visible when switching diff views", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const unified = diff.locator('[data-diff-content="unified"]');
  const split = diff.locator('[data-diff-content="split"]');
  const annotationText = "Should this counter use the catalog_cache prefix";
  const unifiedAnnotation = unified.getByRole("note", { name: "Lines 34-36" });
  const splitAnnotation = split.getByRole("note", { name: "Lines 34-36" });

  await test.step("the annotation follows the selected view", async () => {
    await expect(unifiedAnnotation).toBeVisible();
    await expect(unifiedAnnotation).toContainText(annotationText);
    await expect(splitAnnotation).toBeHidden();

    await diff.getByRole("button", { name: "Side-by-side view" }).click();

    await expect(unifiedAnnotation).toBeHidden();
    await expect(splitAnnotation).toBeVisible();
    await expect(splitAnnotation).toContainText(annotationText);
  });

  await test.step("each split hunk owns one horizontal scroller", async () => {
    const scrollContexts = await split.locator("*").evaluateAll((elements) =>
      elements
        .filter((element) => {
          const overflow = getComputedStyle(element).overflowX;
          return overflow === "auto" || overflow === "scroll";
        })
        .map((element) => element.className),
    );
    expect(scrollContexts).toHaveLength(2);
    expect(scrollContexts.every((classes) =>
      typeof classes === "string" && classes.includes("code-diff-split-scroll")
    )).toBe(true);
    const headerScrollers = await split
      .locator('[data-diff-hunk-header="split"]')
      .evaluateAll((headers) => headers.map((header) =>
        header.parentElement?.classList.contains("code-diff-split-scroll") ?? false
      ));
    expect(headerScrollers).toEqual([true, true]);
  });

  await test.step("the annotation stays pinned in both themes", async () => {
    for (const theme of ["light", "dark"] as const) {
      const layout = await splitAnnotation.evaluate((annotation, selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme;
        const scroller = annotation.closest<HTMLElement>(".code-diff-split-scroll");
        if (scroller === null) {
          throw new Error("Missing split hunk scroller");
        }
        scroller.scrollLeft = scroller.scrollWidth;
        const annotationBox = annotation.getBoundingClientRect();
        const scrollerBox = scroller.getBoundingClientRect();
        const style = getComputedStyle(annotation);
        return {
          annotationLeft: annotationBox.left,
          annotationRight: annotationBox.right,
          background: style.backgroundColor,
          color: style.color,
          scrollerLeft: scrollerBox.left,
          scrollerRight: scrollerBox.right,
          scrollLeft: scroller.scrollLeft,
        };
      }, theme);
      expect(layout.scrollLeft).toBeGreaterThan(0);
      expect(
        Math.abs(layout.annotationLeft - layout.scrollerLeft),
        JSON.stringify(layout),
      ).toBeLessThan(2);
      expect(layout.annotationRight).toBeLessThanOrEqual(layout.scrollerRight + 1);
      expect(layout.color).not.toBe(layout.background);
    }
  });
});

test("should fallback-copy Annotation code within a full-screen diff", async ({
  annotationCodeViewerUrl,
  page,
}) => {
  await page.goto(annotationCodeViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = () => {
      const textarea = document.querySelector("textarea:not([data-diff-source])");
      document.body.dataset.fallbackCopy = textarea instanceof HTMLTextAreaElement
        ? `${textarea.closest("dialog") === null ? "outside" : "dialog"}:${textarea.value}`
        : "missing";
      return textarea instanceof HTMLTextAreaElement;
    };
  });

  const diff = page.locator("[data-code-diff]");
  await diff.getByRole("button", { name: "View diff full screen" }).click();
  const copy = page.locator(
    'dialog [data-diff-content="unified"] [data-code-block] [data-copy-code]',
  );
  await copy.click();

  expect(await page.locator("body").getAttribute("data-fallback-copy")).toBe(
    "dialog:retry();\n",
  );
  await expect(copy).toHaveAccessibleName("Code copied");
});

test("should contain CodeDiff overflow without clipping the page", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  await diff.getByRole("button", { name: "Side-by-side view" }).click();
  const overflow = await page.evaluate(() => ({
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.bodyOverflowX).toBe("visible");
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBe(overflow.clientWidth);
  expect(await diff.locator(".code-diff-split-scroll").first().evaluate(
    (scroller) => scroller.scrollWidth > scroller.clientWidth,
  )).toBe(true);
});

test("should expand a diff to full screen and restore it when dismissed", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const expand = diff.getByRole("button", { name: "View diff full screen" });
  await expand.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await expand.click();

  const dialog = page.locator("dialog.code-diff-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName("src/catalog/read-through-cache.ts");
  await expect(dialog.locator("[data-code-diff]")).toHaveAttribute(
    "data-diff-expanded",
    "",
  );
  await expect(
    dialog.getByRole("button", { name: "Exit full screen" }),
  ).toBeVisible();

  // The modal centers in the viewport and locks the page behind it.
  const horizontalGaps = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: window.innerWidth - box.right };
  });
  expect(horizontalGaps.left).toBeGreaterThan(0);
  expect(Math.abs(horizontalGaps.left - horizontalGaps.right)).toBeLessThan(2);
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).overflow,
      ),
    )
    .toBe("hidden");

  await page.keyboard.press("Escape");

  await expect(page.locator("dialog.code-diff-dialog")).toHaveCount(0);
  await expect(diff).toBeVisible();
  await expect(diff).not.toHaveAttribute("data-diff-expanded", "");
  await expect(
    diff.getByRole("button", { name: "View diff full screen" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
});

test("should copy the raw diff and the file path from the actions menu", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          document.body.dataset.copiedDiff = value;
          return Promise.resolve();
        },
      },
    });
  });

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const menuButton = diff.locator("[data-diff-menu-button]");
  const menu = diff.getByRole("menu", { name: "Diff actions" });

  await expect(menuButton).toHaveAccessibleName("More actions");
  await menuButton.click();
  await expect(menu).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await menu.getByRole("menuitem", { name: "Copy diff" }).click();

  expect(await page.locator("body").getAttribute("data-copied-diff")).toBe(
    RAW_GIT_DIFF,
  );
  await expect(menu).toBeHidden();
  await expect(menuButton).toHaveAccessibleName("Diff copied!");

  await menuButton.click();
  await menu.getByRole("menuitem", { name: "Copy path" }).click();
  expect(await page.locator("body").getAttribute("data-copied-diff")).toBe(
    "src/catalog/read-through-cache.ts",
  );
  await expect(menuButton).toHaveAccessibleName("Path copied!");
});

test("should fallback-copy within a full-screen diff", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = () => {
      const textareas = document.querySelectorAll(
        "textarea:not([data-diff-source])",
      );
      const textarea = textareas.item(textareas.length - 1);
      document.body.dataset.fallbackCopy = textarea instanceof HTMLTextAreaElement
        ? `${textarea.closest("dialog") === null ? "outside" : "dialog"}:${textarea.value}`
        : "missing";
      return textarea instanceof HTMLTextAreaElement;
    };
  });

  const diff = page.locator("[data-code-diff]").first();
  await diff.getByRole("button", { name: "View diff full screen" }).click();
  const expandedDiff = page.locator("dialog [data-code-diff]");
  const menuButton = expandedDiff.locator("[data-diff-menu-button]");
  await expect(page.locator("dialog.code-diff-dialog[open]")).toHaveCount(1);
  await expect(page.locator("textarea:not([data-diff-source])")).toHaveCount(0);
  await menuButton.evaluate((button) => button.click());
  await expandedDiff
    .getByRole("menuitem", { name: "Copy path" })
    .evaluate((button) => button.click());

  expect(await page.locator("body").getAttribute("data-fallback-copy")).toBe(
    "dialog:src/catalog/read-through-cache.ts",
  );
  await expect(menuButton).toBeFocused();
  await expect(menuButton).toHaveAccessibleName("Path copied!");
});

test("should support keyboard navigation in the diff actions menu", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const menuButton = diff.locator("[data-diff-menu-button]");
  const copyPath = diff.getByRole("menuitem", { name: "Copy path" });
  const copyDiff = diff.getByRole("menuitem", { name: "Copy diff" });

  await menuButton.focus();
  await menuButton.press("ArrowDown");
  await expect(copyPath).toBeFocused();
  await copyPath.press("ArrowUp");
  await expect(copyDiff).toBeFocused();
  await copyDiff.press("Home");
  await expect(copyPath).toBeFocused();
  await copyPath.press("End");
  await expect(copyDiff).toBeFocused();
  await copyDiff.press("Escape");
  await expect(menuButton).toBeFocused();
  await expect(diff.getByRole("menu", { name: "Diff actions" })).toBeHidden();

  await menuButton.press("ArrowUp");
  await expect(copyDiff).toBeFocused();
  await copyDiff.press("Tab");
  await expect(diff.getByRole("menu", { name: "Diff actions" })).toBeHidden();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(
    diff.getByRole("button", { name: "View diff full screen" }),
  ).toBeFocused();

  await menuButton.focus();
  await menuButton.press("ArrowDown");
  await expect(copyPath).toHaveAttribute("tabindex", "0");
  await expect(copyDiff).toHaveAttribute("tabindex", "-1");
  await copyPath.press("Shift+Tab");
  await expect(diff.getByRole("menu", { name: "Diff actions" })).toBeHidden();
  await expect(menuButton).toBeFocused();
});

test("should let a short diff actions menu escape the figure", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").last();
  await diff.locator(".code-diff-view").evaluateAll((views) => {
    for (const view of views) {
      view.replaceChildren();
    }
  });
  await diff.getByRole("button", { name: "More actions" }).click();

  const copyDiff = diff.getByRole("menuitem", { name: "Copy diff" });
  await expect(copyDiff).toBeVisible();
  const bounds = await diff.evaluate((figure) => {
    const item = figure.querySelector<HTMLElement>("[data-diff-copy]");
    if (item === null) {
      throw new Error("Missing Copy diff menu item");
    }
    return {
      figureBottom: figure.getBoundingClientRect().bottom,
      itemBottom: item.getBoundingClientRect().bottom,
      figureOverflow: getComputedStyle(figure).overflow,
    };
  });
  expect(bounds.itemBottom).toBeGreaterThan(bounds.figureBottom);
  expect(bounds.figureOverflow).toBe("visible");
});

test("should preserve typed-block content without controls when JavaScript is disabled", async ({
  browser,
  mdxBlocksViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(mdxBlocksViewerUrl);

  await expect(page.locator("[data-callout]")).toHaveCount(4);
  await expect(page.locator("[data-callout]").first()).toBeVisible();
  const diffs = page.locator("[data-code-diff]");
  await expect(diffs).toHaveCount(2);
  await expect(diffs.first().locator('[data-diff-content="unified"]')).toBeVisible();
  await expect(diffs.first().locator('[data-diff-content="split"]')).toBeHidden();
  const annotation = diffs.first()
    .locator('[data-diff-content="unified"]')
    .getByRole("note", { name: "Lines 34-36" });
  await expect(annotation).toBeVisible();
  await expect(annotation).toContainText(
    "Should this counter use the catalog_cache prefix",
  );
  const controls = page.locator(
    "[data-diff-toggle-group], [data-diff-menu-button], [data-diff-expand]",
  );
  await expect(controls).toHaveCount(6);
  for (const control of await controls.all()) {
    await expect(control).toBeHidden();
  }

  await context.close();
});
