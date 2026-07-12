// Browser test of the critical journey: open the rendered sample plan via
// file:// and review it through the TOC. Render-health failures are enforced
// by the fixtures module.

import { expect, test } from "./fixtures";

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
