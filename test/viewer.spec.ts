// Browser test of the critical journey: open the rendered sample plan via
// file:// and review it through the TOC. Render-health failures are enforced
// by the fixtures module.

import { expect, test } from "./fixtures";

const RAW_GIT_DIFF = [
  "diff --git a/src/catalog/read-through-cache.ts b/src/catalog/read-through-cache.ts",
  "index 23ad911..890ce42 100644",
  "--- a/src/catalog/read-through-cache.ts",
  "+++ b/src/catalog/read-through-cache.ts",
  "@@ -18,7 +18,10 @@ export const readCatalog = async (key: string) => {",
  "   const cached = await cache.get(key);",
  "-  if (cached !== null && cached.ageSeconds <= 60) {",
  "+  if (cached !== null && cached.ageSeconds <= 150) {",
  "+    if (cached.ageSeconds > 60) {",
  "+      await refreshQueue.enqueueOnce(key);",
  "+    }",
  "     return cached.value;",
  "   }",
  // The example's blank context line is whitespace-stripped on disk, and the
  // copy action must reproduce the file's exact bytes.
  "",
  "@@ -31,4 +34,5 @@ export const readCatalog = async (key: string) => {",
  "   const value = await catalogOrigin.read(key);",
  "   await cache.put(key, value, { ttlSeconds: 300 });",
  "+  metrics.increment(\"catalog_cache.origin_fallback\");",
  "   return value;",
  " };",
  "",
].join("\n");

test("should navigate the rendered sample plan through the TOC without errors", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);

  await expect(page).toHaveTitle("Payments Retry Architecture Plan");
  const banner = page.getByRole("banner");
  const logo = banner.getByRole("img", { name: "Big Plan" });
  await expect(banner).toBeVisible();
  await expect(logo).toBeVisible();
  await expect(banner.getByRole("link", { name: "Big Plan" })).toHaveAttribute(
    "href",
    "https://big-plan.ai",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Payments Retry Architecture Plan" }),
  ).toBeVisible();

  // The TOC lists every h2 section of the sample document, in order.
  const toc = page.getByRole("navigation", { name: "Contents" });
  await expect(toc.getByRole("link")).toHaveText([
    "Background",
    "Goals and non-goals",
    "Retry state machine",
    "Schema changes",
    "Failure classification",
    "Rollout plan",
  ]);

  // Clicking a TOC entry glides to that section (reduced motion keeps jumps).
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("smooth");
  await toc.getByRole("link", { name: "Rollout plan" }).click();
  await expect(page).toHaveURL(/#rollout-plan$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Rollout plan" }),
  ).toBeInViewport();
  const headerBox = await banner.boundingBox();
  const targetBox = await page
    .getByRole("heading", { level: 2, name: "Rollout plan" })
    .boundingBox();
  expect(headerBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (headerBox !== null && targetBox !== null) {
    expect(headerBox.y).toBeGreaterThanOrEqual(0);
    expect(headerBox.y).toBeLessThanOrEqual(1);
    expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(
      page.viewportSize()?.height ?? Number.POSITIVE_INFINITY,
    );
    expect(targetBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  }

  // The short final section can never lift its heading past the spy
  // threshold, so reaching the bottom must still mark it current.
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight }),
  );
  await expect(toc.getByRole("link", { name: "Rollout plan" })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // The wide classification table scrolls inside its own container instead of
  // widening the page. The stable data attribute is the behavior-bearing
  // interface; utility classes and exact nesting stay implementation detail.
  const wideTable = page.getByRole("table");
  const tableScrollContainer = page.locator("[data-table-scroll-container]");
  await expect(wideTable).toBeVisible();
  await expect(tableScrollContainer).toHaveCount(1);
  await expect
    .poll(() =>
      tableScrollContainer.evaluate(
        (container) => container.scrollWidth > container.clientWidth,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    )
    .toBe(false);
});

test("should switch between light and dark themes", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sampleViewerUrl);

  const toggle = page.getByRole("button", { name: /Use (?:light|dark) theme/ });
  const initialBackground = await page.locator("body").evaluate(
    (body) => getComputedStyle(body).backgroundColor,
  );
  const requestedTheme = (await toggle.getAttribute("aria-label"))?.includes("dark")
    ? "dark"
    : "light";

  await toggle.click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", requestedTheme);
  await expect(toggle).toHaveAccessibleName(
    requestedTheme === "dark" ? "Use light theme" : "Use dark theme",
  );
  await expect
    .poll(() =>
      page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor),
    )
    .not.toBe(initialBackground);

  const doesToggleClearTitle = await page.evaluate(() => {
    const toggleElement = document.querySelector("[data-theme-toggle]");
    const titleElement = document.querySelector("h1");
    if (toggleElement === null || titleElement === null) {
      return false;
    }
    return toggleElement.getBoundingClientRect().bottom <=
      titleElement.getBoundingClientRect().top;
  });
  expect(doesToggleClearTitle).toBe(true);
});

test("should track system theme changes until the reader chooses a theme", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(sampleViewerUrl);

  const toggle = page.locator("[data-theme-toggle]");
  await expect(toggle).toHaveAccessibleName("Use dark theme");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(toggle).toHaveAccessibleName("Use light theme");

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(toggle).toHaveAccessibleName("Use dark theme");
});

test("should copy the exact code-block text", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sampleViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          document.body.dataset.copiedText = value;
          return Promise.resolve();
        },
      },
    });
  });

  const firstCode = page.locator("pre code").first();
  const expectedText = await firstCode.textContent();
  const copyButton = page.locator("[data-copy-code]").first();
  await expect(copyButton).toHaveAccessibleName("Copy code");

  await copyButton.click();

  expect(await page.locator("body").getAttribute("data-copied-text")).toBe(
    expectedText,
  );
  await expect(copyButton).toHaveAccessibleName("Code copied");
  await expect(copyButton.locator('[data-lucide="copy"]')).toBeHidden();
  await expect(copyButton.locator('[data-lucide="check"]')).toBeVisible();
  const copyMessage = copyButton
    .locator("xpath=ancestor::*[@data-code-block]")
    .locator("[data-copy-message]");
  await expect(copyMessage).toBeVisible();
  await expect(copyMessage).toHaveText("Copied!");
  await expect(copyButton).not.toBeFocused();

  const copiedStateFits = await page.evaluate(() => {
    const wrapper = document.querySelector("[data-code-block]");
    const message = wrapper?.querySelector("[data-copy-message]");
    const button = wrapper?.querySelector("[data-copy-code]");
    if (wrapper === null || wrapper === undefined || message === null ||
        message === undefined || button === null || button === undefined) {
      return false;
    }
    const wrapperBox = wrapper.getBoundingClientRect();
    const messageBox = message.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const centerDelta = Math.abs(
      messageBox.top + messageBox.height / 2 -
        (buttonBox.top + buttonBox.height / 2),
    );
    return messageBox.left >= wrapperBox.left &&
      messageBox.right <= buttonBox.left &&
      centerDelta <= 0.5 &&
      document.documentElement.scrollWidth === document.documentElement.clientWidth;
  });
  expect(copiedStateFits).toBe(true);
});

test("should show and reset a visible message when copying fails", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    document.execCommand = () => false;
  });

  const copyButton = page.locator("[data-copy-code]").first();
  const copyMessage = copyButton
    .locator("xpath=ancestor::*[@data-code-block]")
    .locator("[data-copy-message]");

  await copyButton.click();

  await expect(copyButton).toHaveAccessibleName("Could not copy code");
  await expect(copyMessage).toBeVisible();
  await expect(copyMessage).toHaveText("Could not copy");
  await expect(copyButton.locator('[data-lucide="copy"]')).toBeVisible();
  await expect(copyButton.locator('[data-lucide="check"]')).toBeHidden();

  await expect(copyButton).toHaveAccessibleName("Copy code", { timeout: 3_000 });
  await expect(copyMessage).toBeHidden();
});

test("should provide a compact sticky table of contents on mobile", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sampleViewerUrl);

  const toc = page.getByRole("navigation", { name: "Contents" });
  const disclosure = toc.locator("details");
  const overviewLink = toc.locator("[data-overview-link]");
  const retryStateLink = toc.locator(
    '[data-section-link][href="#retry-state-machine"]',
  );
  const bannerBox = await page.getByRole("banner").boundingBox();
  const tocBox = await toc.boundingBox();
  expect(bannerBox?.height).toBe(44);
  expect(tocBox?.y).toBe(44);
  expect(tocBox?.height).toBe(44);
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(disclosure.locator("summary")).toContainText(/Sections\s+6/);
  await expect(overviewLink).toHaveAttribute("aria-current", "true");

  await disclosure.locator("summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
  await retryStateLink.click();
  await expect(page).toHaveURL(/#retry-state-machine$/);
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(disclosure.locator("summary")).toBeFocused();
  await expect(
    page.getByRole("heading", { level: 2, name: "Retry state machine" }),
  ).toBeInViewport();
  // In viewport is not enough: the jump must also land the heading clear of
  // the translucent sticky stack (branding bar plus this TOC), not under it.
  const stackedTocBox = await toc.boundingBox();
  const targetHeadingBox = await page
    .getByRole("heading", { level: 2, name: "Retry state machine" })
    .boundingBox();
  expect(stackedTocBox).not.toBeNull();
  expect(targetHeadingBox).not.toBeNull();
  if (stackedTocBox !== null && targetHeadingBox !== null) {
    expect(targetHeadingBox.y).toBeGreaterThanOrEqual(
      stackedTocBox.y + stackedTocBox.height,
    );
  }
  await expect(retryStateLink).toHaveAttribute("aria-current", "true");

  const themeToggle = page.getByRole("button", {
    name: /Use (?:light|dark) theme/,
  });
  const requestedTheme = (await themeToggle.getAttribute("aria-label"))?.includes(
    "dark",
  )
    ? "dark"
    : "light";
  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", requestedTheme);

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect(overviewLink).toHaveAttribute("aria-current", "true");
});

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

test("should expand a diff to full screen and restore it when dismissed", async ({
  page,
  mdxBlocksViewerUrl,
}) => {
  await page.goto(mdxBlocksViewerUrl);

  const diff = page.locator("[data-code-diff]").first();
  await diff.getByRole("button", { name: "View diff full screen" }).click();

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
  const controls = page.locator(
    "[data-diff-toggle-group], [data-diff-menu-button], [data-diff-expand]",
  );
  await expect(controls).toHaveCount(6);
  for (const control of await controls.all()) {
    await expect(control).toBeHidden();
  }

  await context.close();
});
