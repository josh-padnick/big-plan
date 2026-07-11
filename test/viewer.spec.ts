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
  " ",
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
  const toggle = diff.getByRole("button", { name: "Use side-by-side diff view" });
  await expect(unified).toBeVisible();
  await expect(split).toBeHidden();

  await toggle.click();

  await expect(diff).toHaveAttribute("data-diff-view", "split");
  await expect(unified).toBeHidden();
  await expect(split).toBeVisible();
  await page.reload();
  await expect(diff).toHaveAttribute("data-diff-view", "split");
  await expect(diff.locator("[data-diff-toggle]")).toHaveAccessibleName(
    "Use unified diff view",
  );
});

test("should copy the exact raw git diff when its copy control is used", async ({
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
  await diff.getByRole("button", { name: "Copy diff" }).click();

  expect(await page.locator("body").getAttribute("data-copied-diff")).toBe(
    RAW_GIT_DIFF,
  );
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
  const controls = page.locator("[data-diff-toggle], [data-diff-copy]");
  await expect(controls).toHaveCount(4);
  for (const control of await controls.all()) {
    await expect(control).toBeHidden();
  }

  await context.close();
});
