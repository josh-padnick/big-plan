// Browser tests of the navigation journeys: open the rendered sample plan via
// file:// and move through it with the desktop sidebar TOC and the mobile
// Sections disclosure, landing every jump clear of the sticky chrome.
// Render-health failures are enforced by the fixtures module.

import { boxOf, expect, test } from "./fixtures";

test("should navigate the rendered sample plan through the TOC without errors", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  const banner = page.getByRole("banner");
  const toc = page.getByRole("navigation", { name: "Contents" });
  const rolloutHeading = page.getByRole("heading", {
    level: 2,
    name: "Rollout plan",
  });

  await test.step("the branding bar and document title render", async () => {
    await expect(page).toHaveTitle("Payments Retry Architecture Plan");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("img", { name: "Big Plan" })).toBeVisible();
    await expect(
      banner.getByRole("link", { name: "Big Plan" }),
    ).toHaveAttribute("href", "https://big-plan.ai");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Payments Retry Architecture Plan",
      }),
    ).toBeVisible();
  });

  await test.step("the TOC lists every h2 section in document order", async () => {
    await expect(toc.getByRole("link")).toHaveText([
      "Background",
      "Goals and non-goals",
      "Retry state machine",
      "Schema changes",
      "Failure classification",
      "Rollout plan",
    ]);
  });

  await test.step("clicking a TOC entry glides to that section", async () => {
    // Reduced-motion readers keep instant jumps; everyone else glides.
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe("smooth");
    await toc.getByRole("link", { name: "Rollout plan" }).click();
    await expect(page).toHaveURL(/#rollout-plan$/);
    await expect(rolloutHeading).toBeInViewport();
  });

  await test.step("the jump lands the heading clear of the sticky bar", async () => {
    const headerBox = await boxOf(banner);
    const targetBox = await boxOf(rolloutHeading);
    expect(headerBox.y).toBeGreaterThanOrEqual(0);
    expect(headerBox.y).toBeLessThanOrEqual(1);
    expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(
      page.viewportSize()?.height ?? Number.POSITIVE_INFINITY,
    );
    expect(targetBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  });

  await test.step("reaching the bottom marks the short last section current", async () => {
    // The short final section can never lift its heading past the spy
    // threshold, so the bottom of the page must still mark it current.
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight }),
    );
    await expect(
      toc.getByRole("link", { name: "Rollout plan" }),
    ).toHaveAttribute("aria-current", "true");
  });

  await test.step("wide tables scroll inside their own container", async () => {
    // The stable data attribute is the behavior-bearing interface; utility
    // classes and exact nesting stay implementation detail.
    const tableScrollContainer = page.locator("[data-table-scroll-container]");
    await expect(page.getByRole("table")).toBeVisible();
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

  await test.step("becoming the current section never rewraps a TOC label", async () => {
    const unstable = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          'nav[aria-label="Contents"] a[data-section-link]',
        ),
      ).filter((link) => link.getBoundingClientRect().height > 0);
      const failures: Array<string> = [];
      for (const link of links) {
        const hadCurrent = link.getAttribute("aria-current");
        link.removeAttribute("aria-current");
        const inactive = link.getBoundingClientRect().height;
        link.setAttribute("aria-current", "true");
        const active = link.getBoundingClientRect().height;
        if (hadCurrent === null) {
          link.removeAttribute("aria-current");
        }
        if (inactive !== active) {
          failures.push(link.textContent?.trim() ?? "");
        }
      }
      return failures;
    });
    expect(unstable).toEqual([]);
  });
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
  const retryHeading = page.getByRole("heading", {
    level: 2,
    name: "Retry state machine",
  });

  await test.step("the sticky chrome is two exact 44px rows", async () => {
    const bannerBox = await boxOf(page.getByRole("banner"));
    const tocBox = await boxOf(toc);
    expect(bannerBox.height).toBe(44);
    expect(tocBox.y).toBe(44);
    expect(tocBox.height).toBe(44);
  });

  await test.step("the disclosure starts closed, counting sections, with Overview current", async () => {
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.locator("summary")).toContainText(/Sections\s+6/);
    await expect(overviewLink).toHaveAttribute("aria-current", "true");
  });

  await test.step("picking a section jumps there, closes the menu, and restores focus", async () => {
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await retryStateLink.click();
    await expect(page).toHaveURL(/#retry-state-machine$/);
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.locator("summary")).toBeFocused();
    await expect(retryHeading).toBeInViewport();
  });

  await test.step("the jump lands the heading clear of the sticky stack", async () => {
    // In viewport is not enough: the heading must sit below the translucent
    // sticky rows (branding bar plus this TOC), not under them.
    const stackedTocBox = await boxOf(toc);
    const targetHeadingBox = await boxOf(retryHeading);
    expect(targetHeadingBox.y).toBeGreaterThanOrEqual(
      stackedTocBox.y + stackedTocBox.height,
    );
    await expect(retryStateLink).toHaveAttribute("aria-current", "true");
  });

  await test.step("the theme toggle works alongside the mobile chrome", async () => {
    const themeToggle = page.getByRole("button", {
      name: /Use (?:light|dark) theme/,
    });
    const requestedTheme = (
      await themeToggle.getAttribute("aria-label")
    )?.includes("dark")
      ? "dark"
      : "light";
    await themeToggle.click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      requestedTheme,
    );
  });

  await test.step("returning to the top makes Overview current again", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(overviewLink).toHaveAttribute("aria-current", "true");
  });
});
