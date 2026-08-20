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
    const barTitle = banner.locator("[data-plan-title]");
    await expect(barTitle).toHaveCSS("font-style", "italic");
    expect(
      await barTitle.evaluate((element) => {
        const range = document.createRange();
        range.selectNode(element);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const copiedText = selection?.toString() ?? "";
        selection?.removeAllRanges();
        return copiedText;
      }),
    ).toBe("Payments Retry Architecture Plan");
  });

  await test.step("the TOC lists every h2 section in document order", async () => {
    await expect(toc.locator("ol").getByRole("link")).toHaveText([
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

  await test.step("the disclosure starts closed, counting sections", async () => {
    await expect(disclosure).not.toHaveAttribute("open", "");
    await expect(disclosure.locator("summary")).toContainText(/Sections\s+6/);
  });

  await test.step("picking a section jumps there through the native disclosure", async () => {
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await retryStateLink.click();
    await expect(page).toHaveURL(/#retry-state-machine$/);
    await expect(retryHeading).toBeInViewport();
    // Closing is the reader's native gesture in an inert export.
    await disclosure.locator("summary").click();
    await expect(disclosure).not.toHaveAttribute("open", "");
  });

  await test.step("the jump lands the heading clear of the sticky stack", async () => {
    // In viewport is not enough: the heading must sit below the translucent
    // sticky rows (branding bar plus this TOC), not under them.
    const stackedTocBox = await boxOf(toc);
    const targetHeadingBox = await boxOf(retryHeading);
    expect(targetHeadingBox.y).toBeGreaterThanOrEqual(
      stackedTocBox.y + stackedTocBox.height,
    );
  });
});

test("should keep a long desktop TOC usable while the plan scrolls", async ({
  page,
  longNavigationViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(longNavigationViewerUrl);
  const toc = page
    .getByRole("navigation", { name: "Contents" })
    .filter({ visible: true });
  const list = toc.locator("ol");

  await test.step("the section list is bounded by the viewport and scrolls independently", async () => {
    const listBox = await boxOf(list);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(900 - 48);
    await list.hover();
    const pageScrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => list.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
  });

  await test.step("clicking a distant section preserves the reader's TOC position", async () => {
    const listScrollBefore = await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return node.scrollTop;
    });
    expect(listScrollBefore).toBeGreaterThan(0);

    const lastLink = toc.getByRole("link", {
      name: "Sustainability section 35",
    });
    await lastLink.click();
    await expect(page).toHaveURL(/#sustainability-section-35$/);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Sustainability section 35",
      }),
    ).toBeInViewport();
    await expect
      .poll(() => list.evaluate((node) => node.scrollTop))
      .toBe(listScrollBefore);
  });

  await test.step("the current section remains visible as reading advances", async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(toc.getByRole("link", { name: "Contents" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await page.getByRole("main").hover();
    await page.mouse.wheel(0, 3_800);
    const current = toc.locator('[data-section-link][aria-current="true"]');
    await expect(current).toHaveCount(1);
    await expect
      .poll(() => current.getAttribute("href"))
      .not.toBe("#sustainability-section-01");
    const listBox = await boxOf(list);
    const currentBox = await boxOf(current);
    expect(currentBox.y).toBeGreaterThanOrEqual(listBox.y);
    expect(currentBox.y + currentBox.height).toBeLessThanOrEqual(
      listBox.y + listBox.height,
    );
  });
});

test("should highlight the section being read and return to the top through Contents", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  const toc = page.getByRole("navigation", { name: "Contents" });
  const contentsLink = toc.getByRole("link", { name: "Contents" });
  const rolloutLink = toc.getByRole("link", { name: "Rollout plan" });

  await test.step("Contents itself is current at the very top", async () => {
    await expect(contentsLink).toHaveAttribute("aria-current", "true");
    await expect(toc.locator('ol [aria-current="true"]')).toHaveCount(0);
  });

  await test.step("jumping to a section moves the highlight to its TOC entry", async () => {
    await rolloutLink.click();
    await expect(rolloutLink).toHaveAttribute("aria-current", "true");
    await expect(contentsLink).not.toHaveAttribute("aria-current", "true");
    await expect(toc.locator('ol [aria-current="true"]')).toHaveCount(1);
  });

  await test.step("Contents returns to the top and takes the highlight back", async () => {
    await contentsLink.click();
    await expect(page).toHaveURL(/#top$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Payments Retry Architecture Plan",
      }),
    ).toBeInViewport();
    await expect(contentsLink).toHaveAttribute("aria-current", "true");
    await expect(toc.locator('ol [aria-current="true"]')).toHaveCount(0);
  });
});
