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

    expect(await artboard.evaluate((node) => node.clientWidth)).toBe(1200);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(820);
    expect((await boxOf(frame)).width).toBeGreaterThan(
      (await boxOf(prose)).width,
    );
    await expect(screen.locator(".wireframe-browser-bar")).toHaveCount(1);
    await expect(screen.locator(".wireframe-screen-viewport")).toContainText(
      "workspace viewport",
    );
  });

  await test.step("desktop workspace owns overflow, emphasis, and anchored conversation chrome", async () => {
    const screen = page.locator(
      '[data-wireframe-screen="quality-desk-ticket"]',
    );
    const artboard = screen.locator(".wireframe-artboard");
    const appContent = screen.locator(".wireframe-app-content");
    const workspace = appContent.locator(
      ":scope > .wireframe-row[data-wireframe-workspace]",
    );
    const master = workspace.locator(":scope > [data-wireframe-master]");
    const primary = screen.locator(
      ".wireframe-panel:has(.wireframe-panel-body[data-wireframe-conversation])",
    );
    const rail = workspace.locator(":scope > .wireframe-rail");
    const thread = primary.locator(".wireframe-thread");
    const composer = primary.locator(".wireframe-composer");
    const header = appContent.locator(":scope > .wireframe-page-header");

    for (const region of [artboard, appContent, workspace]) {
      const geometry = await region.evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        overflowX: getComputedStyle(node).overflowX,
      }));
      expect(
        geometry.scrollWidth,
        `${await region.getAttribute("class")} scroll width`,
      ).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.overflowX).not.toBe("auto");
      expect(geometry.overflowX).not.toBe("scroll");
    }

    const masterWidth = (await boxOf(master)).width;
    const primaryWidth = (await boxOf(primary)).width;
    const railWidth = (await boxOf(rail)).width;
    expect(primaryWidth).toBeGreaterThan(masterWidth);
    expect(primaryWidth).toBeGreaterThan(railWidth);

    const threadGeometry = await thread.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(threadGeometry.overflowY).toBe("auto");
    expect(threadGeometry.scrollHeight).toBeGreaterThan(
      threadGeometry.clientHeight,
    );
    const headerBefore = await boxOf(header);
    const composerBefore = await boxOf(composer);
    await thread.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const headerAfter = await boxOf(header);
    const composerAfter = await boxOf(composer);
    expect(headerAfter.y).toBeCloseTo(headerBefore.y, 1);
    expect(composerAfter.y + composerAfter.height).toBeCloseTo(
      composerBefore.y + composerBefore.height,
      1,
    );

    await expect(
      composer.getByText("Internal note · Only your team will see this"),
    ).toBeVisible();
    await expect(
      composer.getByRole("button", { name: "Internal note", exact: true }),
    ).toHaveAttribute("data-wireframe-emphasis", "primary");
    await expect(
      composer.getByRole("button", { name: "Add internal note" }),
    ).toBeVisible();
  });

  await test.step("desktop screen with no workspace row or Center reads at the default measure", async () => {
    const wireframe = page.locator('[data-wireframe="quality-desktop"]');
    await wireframe
      .locator(
        '[data-wireframe-switch]:has-text("Desktop · Workspace settings")',
      )
      .click();
    const screen = wireframe.locator(
      '[data-wireframe-screen="quality-desk-workspace-settings"]:visible',
    );
    const appContent = screen.locator(".wireframe-app-content");
    const header = screen.locator(".wireframe-page-header");
    const aboutPanel = screen.locator(".wireframe-panel", {
      hasText: "About this workspace",
    });
    const recentPanel = screen.locator(".wireframe-panel", {
      hasText: "Recent changes",
    });
    const recentProse = recentPanel.getByText(
      "Workspace changes are retained for 90 days so administrators can audit configuration history.",
    );
    const regionPanel = screen.locator(".wireframe-panel", {
      hasText: "Region",
    });
    const select = regionPanel.locator("select.wireframe-select");
    const textField = regionPanel.locator("input.wireframe-input");

    const appContentWidth = (await boxOf(appContent)).width;
    const headerWidth = (await boxOf(header)).width;
    const aboutWidth = (await boxOf(aboutPanel)).width;
    const recentWidth = (await boxOf(recentPanel)).width;
    const recentProseWidth = (await boxOf(recentProse)).width;
    const selectWidth = (await boxOf(select)).width;
    const textFieldWidth = (await boxOf(textField)).width;

    // A lone settings panel reads at the default prose measure (38rem),
    // clearly narrower than the column it sits in, instead of stretching to
    // fill it.
    expect(aboutWidth).toBeLessThanOrEqual(650);
    expect(aboutWidth).toBeLessThan(appContentWidth - 100);
    // PageHeader is banner chrome: it keeps spanning the column.
    expect(headerWidth).toBeGreaterThan(aboutWidth + 100);
    // A record-collection panel (holding a List) is exempt and stays wide,
    // while prose riding alongside the collection keeps the readable measure.
    expect(recentWidth).toBeGreaterThan(aboutWidth + 100);
    expect(recentProseWidth).toBeLessThanOrEqual(650);
    expect(recentProseWidth).toBeLessThan(recentWidth - 100);
    // A control draws the length of a plausible answer, not the column: no
    // more 900px-wide Select for a two-word region name.
    expect(selectWidth).toBeLessThanOrEqual(400);
    expect(textFieldWidth).toBeLessThanOrEqual(400);
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

      expect(await artboard.evaluate((node) => node.clientWidth)).toBe(1020);
      expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(720);
      const ratio = await artboard.evaluate(
        (node) => node.offsetWidth / node.offsetHeight,
      );
      expect(ratio).toBeGreaterThanOrEqual(1.39);
      expect(ratio).toBeLessThanOrEqual(1.44);
      expect(
        await artboard.evaluate((node) => getComputedStyle(node).overflowY),
      ).toBe("auto");
      // A fixed-frame screen must lay out within its declared artboard - an
      // internal scrollbar is a layout defect, not a scroll affordance.
      // overflow-y stays a safety net (asserted above), never a crutch.
      const { overflow, screenId } = await artboard.evaluate((node) => ({
        overflow: node.scrollHeight - node.clientHeight,
        screenId: node
          .closest("[data-wireframe-screen]")
          ?.getAttribute("data-wireframe-screen"),
      }));
      expect(
        overflow,
        `screen "${screenId}" needs an internal scrollbar (${overflow}px of overflow)`,
      ).toBeLessThanOrEqual(0);
      await expect(screen.locator(".wireframe-browser-bar")).toHaveCount(0);
      await expect(screen.locator(".wireframe-tablet-handle")).toHaveCount(1);
      const targets = await screen
        .locator(
          ".wireframe-button, .wireframe-nav-item, .wireframe-list-item, .wireframe-choice-card, .wireframe-input",
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

  await test.step("tablet simple choices dominate, start empty, and reveal continuation after tap", async () => {
    const wireframe = page.locator('[data-wireframe="quality-tablet"]');
    await wireframe
      .locator('[data-wireframe-switch]:has-text("Tablet · Choose")')
      .click();
    const initial = wireframe.locator(
      '[data-wireframe-screen="quality-tablet-choose"]:visible',
    );
    const choiceGroup = initial.locator(".wireframe-choice-group");
    const initialCards = choiceGroup.locator(".wireframe-choice-card");

    await expect(initialCards).toHaveCount(3);
    await expect(
      choiceGroup.locator(".wireframe-choice-card[data-wireframe-selected]"),
    ).toHaveCount(0);
    await expect(
      initial.locator('.wireframe-button[data-wireframe-emphasis="primary"]'),
    ).toHaveCount(0);
    const choiceGroupBox = await boxOf(choiceGroup);
    const tabletArtboardBox = await boxOf(
      initial.locator(".wireframe-artboard"),
    );
    expect(choiceGroupBox.width / tabletArtboardBox.width).toBeGreaterThan(0.7);
    const cardHeights = await initialCards.evaluateAll((nodes) =>
      nodes.map((node) =>
        node instanceof HTMLElement ? node.offsetHeight : 0,
      ),
    );
    expect(
      cardHeights.every((height) => height >= 96),
      `choice-card heights: ${cardHeights.join(", ")}`,
    ).toBe(true);
    const competingRows = initial.locator(
      ".wireframe-row:has(.wireframe-choice-group)",
    );
    await expect(competingRows).toHaveCount(0);
    const groupBackground = await choiceGroup.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const artboardBackground = await initial
      .locator(".wireframe-artboard")
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(groupBackground).not.toBe(artboardBackground);

    await initialCards.first().click();
    const selectedScreen = wireframe.locator(
      '[data-wireframe-screen="quality-tablet-purchase-selected"]:visible',
    );
    const selected = selectedScreen.locator(
      ".wireframe-choice-card[data-wireframe-selected]",
    );
    await expect(selected).toHaveCount(1);
    const unselected = selectedScreen
      .locator(".wireframe-choice-card:not([data-wireframe-selected])")
      .first();
    await expect(unselected).toHaveCount(1);
    const selectedPaint = await selected.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        borderWidth: style.borderTopWidth,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
      };
    });
    const unselectedBorderWidth = await unselected.evaluate(
      (node) => getComputedStyle(node).borderTopWidth,
    );
    // The authored 3px selected border paints thinner than 3px once the
    // tablet's true width is scaled into the review column, so this compares
    // against the same screen's resting (2px authored) border rather than a
    // fixed pixel threshold that drifts every time the device preset changes.
    expect(Number.parseFloat(selectedPaint.borderWidth)).toBeGreaterThan(
      Number.parseFloat(unselectedBorderWidth) * 1.3,
    );
    expect(selectedPaint.boxShadow).not.toBe("none");
    await expect(selected.locator(".wireframe-choice-check")).toHaveText("✓");
    await expect(
      selectedScreen.getByRole("button", { name: "Continue" }),
    ).toBeVisible();
    await expect(
      selectedScreen.getByRole("button", { name: "Back to my wallet" }),
    ).toBeVisible();
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

test("should keep sparse app shell chrome compact and workspace full-width", async ({
  page,
  wireframeSparseAppShellViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(wireframeSparseAppShellViewerUrl);

  const topBarWireframe = page.locator(
    '[data-wireframe="sparse-app-shell-top-bar"]',
  );
  const artboard = topBarWireframe.locator(".wireframe-artboard");
  const topBar = topBarWireframe.locator(".wireframe-top-bar");
  const appContent = topBarWireframe.locator(".wireframe-app-content");
  const artboardHeight = await artboard.evaluate((node) => node.offsetHeight);
  const topBarHeight = await topBar.evaluate((node) => node.offsetHeight);

  expect(artboardHeight).toBe(820);
  expect(topBarHeight).toBeLessThan(artboardHeight * 0.2);
  expect(topBarHeight).toBeGreaterThanOrEqual(48);
  await expect(topBar).toHaveCSS("border-bottom-style", "solid");
  expect(
    await topBar.evaluate((node) =>
      parseFloat(getComputedStyle(node).borderBottomWidth),
    ),
  ).toBeGreaterThan(1);
  const titleAlignment = await topBar.evaluate((node) => {
    const titleNode = node.querySelector(".wireframe-brand");
    if (!(titleNode instanceof HTMLElement)) {
      return { contentLeft: Number.NaN, titleLeft: Number.NaN };
    }
    const topBarBox = node.getBoundingClientRect();
    const scale = topBarBox.width / node.offsetWidth;
    return {
      contentLeft:
        topBarBox.left +
        Number.parseFloat(getComputedStyle(node).paddingLeft) * scale,
      titleLeft: titleNode.getBoundingClientRect().left,
    };
  });
  expect(
    Math.abs(titleAlignment.titleLeft - titleAlignment.contentLeft),
  ).toBeLessThan(0.75);
  expect(
    await appContent.evaluate((node) => node.clientHeight),
  ).toBeGreaterThan(topBarHeight * 3);
  expect(await appContent.evaluate((node) => node.clientWidth)).toBeGreaterThan(
    800,
  );

  const noTopBarWireframe = page.locator(
    '[data-wireframe="sparse-app-shell-no-top-bar"]',
  );
  const noTopBarShell = noTopBarWireframe.locator(".wireframe-app-shell");
  const noTopBarContent = noTopBarWireframe.locator(".wireframe-app-content");
  const noTopBarShellBox = await boxOf(noTopBarShell);
  const noTopBarContentBox = await boxOf(noTopBarContent);
  expect(Math.abs(noTopBarContentBox.x - noTopBarShellBox.x)).toBeLessThan(
    0.75,
  );
  expect(
    Math.abs(noTopBarContentBox.width - noTopBarShellBox.width),
  ).toBeLessThan(0.75);
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
            paneWidths.every((width) => width >= 280),
            `pane widths: ${paneWidths.join(", ")}`,
          ).toBe(true);

          const workspaces = screen.locator(
            ".wireframe-row[data-wireframe-workspace]",
          );
          for (
            let workspaceIndex = 0;
            workspaceIndex < (await workspaces.count());
            workspaceIndex += 1
          ) {
            const workspace = workspaces.nth(workspaceIndex);
            const masterWidths = await workspace
              .locator(":scope > [data-wireframe-master]")
              .evaluateAll((nodes) =>
                nodes.map((node) =>
                  node instanceof HTMLElement ? node.offsetWidth : 0,
                ),
              );
            const railWidths = await workspace
              .locator(":scope > .wireframe-rail")
              .evaluateAll((nodes) =>
                nodes.map((node) =>
                  node instanceof HTMLElement ? node.offsetWidth : 0,
                ),
              );
            const primaryWidths = await workspace
              .locator(
                ":scope > :is(.wireframe-panel, .wireframe-stack, .wireframe-center):not([data-wireframe-master])",
              )
              .evaluateAll((nodes) =>
                nodes.map((node) =>
                  node instanceof HTMLElement ? node.offsetWidth : 0,
                ),
              );
            const boundedWidths = [...masterWidths, ...railWidths];
            if (primaryWidths.length > 0 && boundedWidths.length > 0) {
              expect(Math.max(...primaryWidths)).toBeGreaterThan(
                Math.max(...boundedWidths),
              );
            } else if (masterWidths.length === 1 && railWidths.length === 1) {
              expect(masterWidths[0]).toBeGreaterThan(railWidths[0]);
            }
          }

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

// The floors are product judgement, set by looking at rendered documents, not
// an accessibility standard: WCAG governs how text may be resized, not how
// small a default may be. They are fenced here anyway, because a legibility
// standard nobody measures regresses the next time a constant moves, and this
// is the one defect a reader notices before anything else on the page.
const PAINTED_FLOORS: ReadonlyArray<{
  readonly role: string;
  readonly selector: string;
  readonly minimum: number;
}> = [
  // Ordinary content and controls: what the reviewer actually reads.
  { role: "body", selector: ".wireframe-artboard", minimum: 12 },
  { role: "list row", selector: ".wireframe-list-item", minimum: 12 },
  { role: "button", selector: ".wireframe-button", minimum: 12 },
  { role: "field label", selector: ".wireframe-field-label", minimum: 11 },
  { role: "panel title", selector: ".wireframe-panel-title", minimum: 12 },
  // Metadata and labels: scanned rather than read, so they may sit lower.
  { role: "list metadata", selector: ".wireframe-list-meta", minimum: 10 },
  { role: "eyebrow", selector: ".wireframe-eyebrow", minimum: 10 },
];

test("should paint every text role above its legibility floor on every device", async ({
  page,
  wireframeFormFactorsViewerUrl,
  wireframeQualityViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const url of [
    wireframeQualityViewerUrl,
    wireframeFormFactorsViewerUrl,
  ]) {
    await page.goto(url);
    // Every device, not only the one that scales the most: a floor that holds
    // on desktop and not on tablet is a floor the reader still falls through.
    const screens = page.locator("[data-wireframe-screen]");

    for (
      let screenIndex = 0;
      screenIndex < (await screens.count());
      screenIndex += 1
    ) {
      const screen = screens.nth(screenIndex);
      const screenId = await screen.getAttribute("data-wireframe-screen");

      const painted = await screen.evaluate(
        (node, floors) => {
          const frame = node.querySelector(".wireframe-frame");
          if (!(frame instanceof HTMLElement)) {
            return [];
          }
          // The artboard is laid out at its true device width and scaled as
          // one unit, so the size a reviewer reads is the declared size times
          // that scale. Measuring the declared size alone measures nothing.
          const zoom = Number.parseFloat(getComputedStyle(frame).zoom) || 1;
          return floors.flatMap(({ role, selector, minimum }) =>
            [...node.querySelectorAll(selector)].flatMap((element) => {
              const declared = Number.parseFloat(
                getComputedStyle(element).fontSize,
              );
              const paintedSize = declared * zoom;
              return paintedSize < minimum
                ? [
                    `${role} paints ${paintedSize.toFixed(1)}px (floor ${minimum}px)`,
                  ]
                : [];
            }),
          );
        },
        [...PAINTED_FLOORS],
      );

      expect(painted, `screen "${screenId}"`).toEqual([]);
    }
  }
});

test("should keep ordinary rows content-driven instead of manufacturing dead bands", async ({
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
              const viewportWorkspace =
                row.hasAttribute("data-wireframe-workspace") &&
                row.closest(
                  '.wireframe-artboard[data-wireframe-device="desktop"]:has(.wireframe-app-shell)',
                ) !== null;
              return (minHeight > 0 || growsVertically) && !viewportWorkspace
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
