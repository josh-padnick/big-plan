// Browser geometry fence for the wireframe quality bar: shipped proof and
// showcase documents must preserve readable pane floors, non-overlapping
// layout regions, content-driven rows, and device-native outer chrome.

import { boxOf, expect, test } from "./fixtures";

test("should render every proof at its native device geometry", async ({
  page,
  wireframeQualityViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(wireframeQualityViewerUrl);

  await test.step("desktop is wider than prose and keeps its logical floor", async () => {
    const screen = page.locator(
      '[data-wireframe-screen="quality-desk-ticket"]',
    );
    const frame = screen.locator(".wireframe-frame");
    const artboard = screen.locator(".wireframe-artboard");
    const prose = page.locator("article p").first();

    expect(await artboard.evaluate((node) => node.clientWidth)).toBe(1440);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(900);
    expect((await boxOf(frame)).width).toBeGreaterThan(
      (await boxOf(prose)).width,
    );
    await expect(screen.locator(".wireframe-browser-bar")).toHaveCount(1);
  });

  await test.step("tablet holds a real iPad ratio and carries no browser shell", async () => {
    const wireframe = page.locator('[data-wireframe="quality-tablet"]');
    const switches = wireframe.locator("[data-wireframe-switch]");

    for (
      let screenIndex = 0;
      screenIndex < (await switches.count());
      screenIndex += 1
    ) {
      await switches.nth(screenIndex).click();
      const screen = wireframe.locator(
        '[data-wireframe-device="tablet"]:visible',
      );
      const artboard = screen.locator(".wireframe-artboard");

      expect(await artboard.evaluate((node) => node.clientWidth)).toBe(1180);
      expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(820);
      const ratio = await artboard.evaluate(
        (node) => node.offsetWidth / node.offsetHeight,
      );
      expect(ratio).toBeGreaterThanOrEqual(1.39);
      expect(ratio).toBeLessThanOrEqual(1.44);
      expect(
        await artboard.evaluate((node) => getComputedStyle(node).overflowY),
      ).toBe("auto");
      await expect(screen.locator(".wireframe-browser-bar")).toHaveCount(0);
      await expect(screen.locator(".wireframe-tablet-handle")).toHaveCount(1);
      const targets = await screen
        .locator(
          ".wireframe-button, .wireframe-nav-item, .wireframe-list-item, .wireframe-input",
        )
        .evaluateAll((nodes) =>
          nodes.map((node) =>
            node instanceof HTMLElement ? node.offsetHeight : 0,
          ),
        );
      expect(
        targets.every((height) => height >= 44),
        `touch targets: ${targets.join(", ")}`,
      ).toBe(true);
      const completedStepMarks = await screen
        .locator('[data-wireframe-step="done"]')
        .evaluateAll((steps) =>
          steps.map((step) => getComputedStyle(step, "::before").content),
        );
      expect(
        completedStepMarks.every((mark) => mark === '"✓"'),
        `completed step marks: ${completedStepMarks.join(", ")}`,
      ).toBe(true);
    }
  });

  await test.step("phone is single-column native chrome with touch targets", async () => {
    const screen = page.locator(
      '[data-wireframe-screen="quality-phone-inbox"]',
    );
    const artboard = screen.locator(".wireframe-artboard");

    expect(await artboard.evaluate((node) => node.offsetWidth)).toBe(390);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(720);
    await expect(screen.locator(".wireframe-browser-bar")).toHaveCount(0);
    await expect(screen.locator(".wireframe-app-shell")).toHaveCount(0);
    await expect(screen.locator(".wireframe-sidebar")).toHaveCount(0);
    await expect(screen.locator(".wireframe-top-bar")).toHaveCount(1);
    await expect(screen.locator(".wireframe-bottom-bar")).toHaveCount(1);
    const targets = await screen
      .locator(".wireframe-button, .wireframe-list-item")
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          node instanceof HTMLElement ? node.offsetHeight : 0,
        ),
      );
    expect(targets.every((height) => height >= 44)).toBe(true);
  });
});

test("should keep shipped desktop panes readable and layout regions separate", async ({
  page,
  wireframeFormFactorsViewerUrl,
  wireframeQualityViewerUrl,
}) => {
  for (const url of [
    wireframeQualityViewerUrl,
    wireframeFormFactorsViewerUrl,
  ]) {
    await page.goto(url);
    const desktopWireframes = page.locator(
      '[data-wireframe]:has([data-wireframe-device="desktop"])',
    );

    for (
      let wireframeIndex = 0;
      wireframeIndex < (await desktopWireframes.count());
      wireframeIndex += 1
    ) {
      const wireframe = desktopWireframes.nth(wireframeIndex);
      const switches = wireframe.locator("[data-wireframe-switch]");
      const screenCount = Math.max(await switches.count(), 1);

      for (let screenIndex = 0; screenIndex < screenCount; screenIndex += 1) {
        if ((await switches.count()) > 0) {
          await switches.nth(screenIndex).click();
        }
        const screen = wireframe.locator(
          '[data-wireframe-device="desktop"]:visible',
        );

        await test.step(`${await wireframe.getAttribute("data-wireframe")} screen ${screenIndex + 1}`, async () => {
          const paneWidths = await screen
            .locator(
              ".wireframe-row[data-wireframe-workspace] > :is(.wireframe-panel, .wireframe-stack, .wireframe-center, .wireframe-rail)",
            )
            .evaluateAll((nodes) =>
              nodes.map((node) =>
                node instanceof HTMLElement ? node.offsetWidth : 0,
              ),
            );
          expect(
            paneWidths.every((width) => width >= 300),
            `pane widths: ${paneWidths.join(", ")}`,
          ).toBe(true);

          const overlaps = await screen
            .locator(".wireframe-row, .wireframe-app-shell")
            .evaluateAll((containers) =>
              containers.flatMap((container) => {
                const children = Array.from(container.children).filter(
                  (child): child is HTMLElement =>
                    child instanceof HTMLElement &&
                    getComputedStyle(child).display !== "none" &&
                    !["absolute", "fixed"].includes(
                      getComputedStyle(child).position,
                    ),
                );
                return children.flatMap((left, leftIndex) =>
                  children.slice(leftIndex + 1).flatMap((right) => {
                    const a = left.getBoundingClientRect();
                    const b = right.getBoundingClientRect();
                    const overlapWidth =
                      Math.min(a.right, b.right) - Math.max(a.left, b.left);
                    const overlapHeight =
                      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    return overlapWidth > 1 && overlapHeight > 1
                      ? [
                          `${left.className} overlaps ${right.className} by ${overlapWidth.toFixed(1)}×${overlapHeight.toFixed(1)}`,
                        ]
                      : [];
                  }),
                );
              }),
            );
          expect(overlaps).toEqual([]);
        });
      }
    }
  }
});

test("should keep rows content-driven instead of manufacturing dead bands", async ({
  page,
  wireframeFormFactorsViewerUrl,
  wireframeQualityViewerUrl,
}) => {
  for (const url of [
    wireframeQualityViewerUrl,
    wireframeFormFactorsViewerUrl,
  ]) {
    await page.goto(url);
    const wireframes = page.locator("[data-wireframe]");

    for (
      let wireframeIndex = 0;
      wireframeIndex < (await wireframes.count());
      wireframeIndex += 1
    ) {
      const wireframe = wireframes.nth(wireframeIndex);
      const switches = wireframe.locator("[data-wireframe-switch]");
      const screenCount = Math.max(await switches.count(), 1);

      for (let screenIndex = 0; screenIndex < screenCount; screenIndex += 1) {
        if ((await switches.count()) > 0) {
          await switches.nth(screenIndex).click();
        }
        const screen = wireframe.locator(".wireframe-screen:visible");
        const forcedBands = await screen
          .locator(".wireframe-row")
          .evaluateAll((rows) =>
            rows.flatMap((row) => {
              const style = getComputedStyle(row);
              const minHeight = Number.parseFloat(style.minHeight);
              const flexGrow = Number.parseFloat(style.flexGrow);
              const parentDirection =
                row.parentElement === null
                  ? ""
                  : getComputedStyle(row.parentElement).flexDirection;
              const growsVertically =
                parentDirection.startsWith("column") && flexGrow > 0;
              return minHeight > 0 || growsVertically
                ? [
                    `${row.className}: min-height ${style.minHeight}, flex-grow ${style.flexGrow} in ${parentDirection}`,
                  ]
                : [];
            }),
          );
        expect(forcedBands).toEqual([]);
      }
    }
  }
});
