// Browser tests of the wireframe reading journey: the drawing a reviewer
// meets, walking a prototype from one screen to another and back, the
// keyboard route through the same path, the caption that names each screen
// beneath it, and true-size drawings scaling into the review surface.
// Render-health failures are enforced by the fixtures.

import { boxOf, expect, test } from "./fixtures";

type TestLocator = Parameters<typeof boxOf>[0];

// Maximizing schedules a fit through a ResizeObserver, so waiting on the
// attribute alone can measure geometry the fit has not answered for yet. The
// frame's own zoom is the one value the fit always rewrites, so this waits
// for that value to stop moving. It deliberately does not wait for it to
// change: a maximized panel can offer the frame the same width the article
// column did, and then the settled answer is the resting one.
const maximizeAfterFrameFit = async (wireframe: TestLocator): Promise<void> => {
  const frame = wireframe.locator(".wireframe-frame").first();
  await wireframe.locator("[data-figure-maximize]").click();
  await expect(wireframe).toHaveAttribute("data-figure-maximized", "");
  let previous = Number.NaN;
  await expect
    .poll(async () => {
      const zoom = await frame.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).zoom),
      );
      const settled =
        Number.isFinite(zoom) && zoom > 0 && Math.abs(zoom - previous) < 0.0001;
      previous = zoom;
      return settled;
    })
    .toBe(true);
};

// The caption is a figcaption pinned to the width the frame paints at, so its
// edges land on the card's edges however far the drawing has been scaled.
// The fit runs from a ResizeObserver, so the alignment is polled rather than
// sampled once: a layout change that has not yet been fitted is a pending
// answer, not a failing one.
const expectCaptionAlignedToFrame = async (
  screen: TestLocator,
  tolerance = 4,
): Promise<void> => {
  await expect(screen).toBeVisible();
  await expect
    .poll(() =>
      screen.evaluate((node) => {
        const caption = node.querySelector<HTMLElement>(
          ":scope > .wireframe-screen-caption",
        );
        const card = node.querySelector<HTMLElement>(
          ":scope > .wireframe-frame-card",
        );
        if (caption === null || card === null) {
          throw new Error("screen caption and frame card are incomplete");
        }
        const captionBox = caption.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        // A screen that is not displayed measures as an all-zero rect, which
        // would make every edge agree and pass this vacuously.
        if (cardBox.width === 0 || captionBox.width === 0) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.max(
          Math.abs(captionBox.left - cardBox.left),
          Math.abs(captionBox.right - cardBox.right),
        );
      }),
    )
    .toBeLessThan(tolerance);
};

// Everything the caption contract asserts about one rendered figcaption,
// measured in one round trip so the desktop and mobile cases below state the
// same bar rather than two drifting copies of it.
const captionContractOf = async (wireframe: TestLocator) =>
  wireframe.evaluate((node) => {
    const body = node.querySelector<HTMLElement>(":scope > [data-figure-body]");
    const screen = node.querySelector<HTMLElement>(".wireframe-screen");
    const caption = node.querySelector<HTMLElement>(
      ".wireframe-screen figcaption",
    );
    const card = node.querySelector<HTMLElement>(".wireframe-frame-card");
    if (body === null || screen === null || caption === null || card === null) {
      throw new Error("captioned screen is incomplete");
    }
    const name = caption.querySelector<HTMLElement>(".wireframe-screen-name");
    const viewport = caption.querySelector<HTMLElement>(
      ".wireframe-screen-viewport",
    );
    if (name === null || viewport === null) {
      throw new Error("caption metadata is incomplete");
    }
    const bodyBox = body.getBoundingClientRect();
    const captionBox = caption.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const nameBox = name.getBoundingClientRect();
    const viewportBox = viewport.getBoundingClientRect();
    const captionStyle = getComputedStyle(caption);
    const nameStyle = getComputedStyle(name);
    const viewportStyle = getComputedStyle(viewport);
    const nameLineHeight = Number.parseFloat(nameStyle.lineHeight);
    return {
      directChild: caption.parentElement === screen,
      nameLineCount: nameBox.height / nameLineHeight,
      captionBottomGap: cardBox.top - captionBox.bottom,
      leftDelta: Math.abs(captionBox.left - cardBox.left),
      rightDelta: Math.abs(captionBox.right - cardBox.right),
      metadataGap: viewportBox.top - nameBox.bottom,
      nameDisplay: nameStyle.display,
      nameFontSize: Number.parseFloat(nameStyle.fontSize),
      nameLineHeight,
      captionFont: captionStyle.fontFamily,
      readingFont: getComputedStyle(document.body).fontFamily,
      captionTracking: captionStyle.letterSpacing,
      nameColor: nameStyle.color,
      metadataColor: viewportStyle.color,
      metadataDisplay: viewportStyle.display,
      metadataFontSize: Number.parseFloat(viewportStyle.fontSize),
      stackHeight: cardBox.bottom - captionBox.top,
      availableHeight: bodyBox.height,
      stackTopInset: captionBox.top - bodyBox.top,
      stackBottomInset: bodyBox.bottom - cardBox.bottom,
      horizontalOverflow: body.scrollWidth - body.clientWidth,
      verticalOverflow: body.scrollHeight - body.clientHeight,
    };
  });

const expectCaptionContract = (
  contract: Awaited<ReturnType<typeof captionContractOf>>,
  { alignmentTolerance }: { readonly alignmentTolerance: number },
): void => {
  // Semantics: the caption belongs to the screen's own figure, and leads it -
  // the device it is drawn at and the control for commenting on it sit under
  // the switcher that selected the screen, not stacked under the drawing
  // against the switcher's own name for it.
  expect(contract.directChild).toBe(true);
  expect(contract.captionBottomGap).toBeGreaterThanOrEqual(10);
  expect(contract.captionBottomGap).toBeLessThanOrEqual(14);
  // Typography: the reading sans at the caption step, not the sketch hand,
  // and no tracking of its own.
  expect(contract.captionFont).toBe(contract.readingFont);
  expect(["normal", "0px"]).toContain(contract.captionTracking);
  expect(contract.nameFontSize).toBe(14);
  expect(contract.nameLineHeight / contract.nameFontSize).toBeGreaterThan(1.35);
  expect(contract.nameLineHeight / contract.nameFontSize).toBeLessThan(1.55);
  // Hierarchy: two stacked lines, the metadata subordinate in size and ink.
  expect(contract.nameDisplay).toBe("block");
  expect(contract.metadataDisplay).toBe("block");
  expect(contract.metadataFontSize).toBe(12);
  expect(contract.metadataFontSize).toBeLessThan(contract.nameFontSize);
  expect(contract.metadataColor).not.toBe(contract.nameColor);
  expect(contract.metadataGap).toBeGreaterThanOrEqual(4);
  expect(contract.metadataGap).toBeLessThanOrEqual(6);
  // Wrapping and fit: a long name takes more than one line, both lines stay
  // on the frame, and the whole stack fits the panel with nothing to scroll.
  expect(contract.nameLineCount).toBeGreaterThanOrEqual(2);
  expect(contract.leftDelta).toBeLessThan(alignmentTolerance);
  expect(contract.rightDelta).toBeLessThan(alignmentTolerance);
  expect(contract.stackHeight).toBeLessThanOrEqual(
    contract.availableHeight + 1,
  );
  expect(contract.stackTopInset).toBeGreaterThanOrEqual(-1);
  expect(contract.stackBottomInset).toBeGreaterThanOrEqual(-1);
  // The fit lands the stack on the panel's height exactly, and scrollHeight
  // and clientHeight round independently, so a sub-pixel residue can show as
  // one pixel - the same tolerance the stack height above already allows.
  expect(contract.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(contract.verticalOverflow).toBeLessThanOrEqual(1);
};

test("should walk the wireframe prototype between screens", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);
  const wireframe = page.locator("[data-wireframe]");
  const home = page.locator('[data-wireframe-screen="child-home"]');
  const lesson = page.locator('[data-wireframe-screen="loan-lesson"]');

  await test.step("the initial screen is the one drawn", async () => {
    await expect(home).toBeVisible();
    await expect(lesson).toBeHidden();
    await expect(home).toContainText("Hi, Eddy!");
    await expect(home).toContainText("$42.50");
  });

  await test.step("an action inside the drawing moves the prototype", async () => {
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(lesson).toBeVisible();
    await expect(home).toBeHidden();
    await expect(lesson).toContainText("Borrow now, repay later");
  });

  await test.step("the screen switcher follows the walk", async () => {
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await expect(
      switcher.getByRole("button", { name: "Loan lesson" }),
    ).toHaveAttribute("aria-current", "true");
  });

  await test.step("the prototype walks back the way it came", async () => {
    await page.getByRole("button", { name: "I understand" }).click();
    await expect(home).toBeVisible();
    await expect(lesson).toBeHidden();
  });

  await test.step("the switcher jumps straight to any screen", async () => {
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await switcher.getByRole("button", { name: "Loan lesson" }).click();
    await expect(lesson).toBeVisible();
  });

  await test.step("the drawing carries no script of its own", async () => {
    await expect(wireframe.locator("script")).toHaveCount(0);
  });
});

test("should reach every prototype action from the keyboard", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);
  const lesson = page.locator('[data-wireframe-screen="loan-lesson"]');

  const action = page.getByRole("button", { name: "Start lesson" });
  await action.focus();
  await expect(action).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lesson).toBeVisible();
});

// A maximized figure is opened to see the whole device at once, so the fit has
// to answer both axes. Fitting width alone leaves a short wide window scrolling
// the frame out of view, which is what a reader sees as a scrollbar down the
// side of a drawing that no longer fits. This shipped once and was silently
// reverted when a long-lived branch merged its older copy of the viewer script
// back over it, together with the assertion that would have caught it - so the
// assertion is stated here for every device the rail can reach.
test("should fit a maximized screen to the panel on both axes", async ({
  page,
  wireframeQualityViewerUrl,
}) => {
  // Wide and short is the shape that exposes a width-only fit: there is room
  // to spare across, and none to spare down.
  await page.setViewportSize({ width: 1855, height: 968 });
  await page.goto(wireframeQualityViewerUrl);

  const figure = page
    .locator('[data-wireframe]:has([data-wireframe-device="desktop"])')
    .first();
  await figure.locator("[data-figure-maximize]").click();
  await expect(figure).toHaveAttribute("data-figure-maximized", "");

  const rail = figure.getByRole("navigation", { name: "Prototype screens" });
  const screenCount = Math.max(await rail.getByRole("button").count(), 1);

  for (let screenIndex = 0; screenIndex < screenCount; screenIndex += 1) {
    if ((await rail.getByRole("button").count()) > 0) {
      await rail.getByRole("button").nth(screenIndex).click();
    }
    const screen = figure.locator("[data-wireframe-screen]:visible");
    const readFit = () =>
      screen.evaluate((node) => ({
        id: node.getAttribute("data-wireframe-screen"),
        overflow: node.scrollHeight - node.clientHeight,
        zoom: Number.parseFloat(
          getComputedStyle(
            node.querySelector(".wireframe-frame") ?? node,
          ).zoom.toString(),
        ),
      }));
    // The refit for a newly shown screen is scheduled in requestAnimationFrame,
    // so it lands a frame after the click resolves. Measuring straight away
    // reads the previous screen's zoom - which is either a false pass or a
    // false failure, depending on which screen was shown before.
    await expect
      .poll(async () => (await readFit()).overflow)
      .toBeLessThanOrEqual(0);
    const fit = await readFit();
    expect(
      fit.overflow,
      `maximized screen "${fit.id}" overflows its panel by ${fit.overflow}px`,
    ).toBeLessThanOrEqual(0);
    // A fit that solved the overflow by shrinking the drawing to nothing would
    // pass the assertion above and fail the reader.
    expect(fit.zoom, `maximized screen "${fit.id}" zoom`).toBeGreaterThan(0.5);
  }
});

test("should maximize into a left screen rail, sequence it with arrow keys, and restore cleanly", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);
  const frame = page.locator("[data-wireframe]");
  const trigger = frame.locator("[data-figure-maximize]");
  const rail = frame.getByRole("navigation", { name: "Prototype screens" });

  await test.step("maximize promotes the figure and reveals the rail", async () => {
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(frame).toHaveAttribute("data-figure-maximized", "");
    await expect(rail).toBeVisible();
    await expect(rail).toHaveCSS("flex-direction", "column");
    await expect(
      rail.getByRole("button", { name: "My wallet" }),
    ).toHaveAttribute("aria-current", "true");
    // The rail takes width from the screen box, so the frame refits into a
    // narrower slot; the caption beneath it has to follow rather than keep
    // the width it was drawn at and overhang the drawing it names.
    await expectCaptionAlignedToFrame(
      page.locator('[data-wireframe-screen="child-home"]'),
    );
  });

  await test.step("clicking a rail item switches the active screen", async () => {
    await rail.getByRole("button", { name: "Activity" }).click();
    await expect(
      page.locator('[data-wireframe-screen="activity"]'),
    ).toBeVisible();
    await expect(
      rail.getByRole("button", { name: "Activity" }),
    ).toHaveAttribute("aria-current", "true");
  });

  await test.step("arrow keys sequence through the rail and move focus with it", async () => {
    await page.keyboard.press("ArrowDown");
    await expect(
      page.locator('[data-wireframe-screen="loan-lesson"]'),
    ).toBeVisible();
    await expect(
      rail.getByRole("button", { name: "Loan lesson" }),
    ).toBeFocused();
    await expect(
      rail.getByRole("button", { name: "Loan lesson" }),
    ).toHaveAttribute("aria-current", "true");

    await page.keyboard.press("ArrowUp");
    await expect(
      page.locator('[data-wireframe-screen="activity"]'),
    ).toBeVisible();
    await expect(rail.getByRole("button", { name: "Activity" })).toBeFocused();

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(
      page.locator('[data-wireframe-screen="child-home"]'),
    ).toBeVisible();
    // Clamped at the first screen rather than wrapping.
    await page.keyboard.press("ArrowUp");
    await expect(
      page.locator('[data-wireframe-screen="child-home"]'),
    ).toBeVisible();
  });

  await test.step("Escape restores the figure and returns focus to the trigger", async () => {
    await page.keyboard.press("Escape");
    await expect(frame).not.toHaveAttribute("data-figure-maximized");
    await expect(trigger).toBeFocused();
    // The switcher keeps the screen the rail last selected.
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await expect(
      switcher.getByRole("button", { name: "My wallet" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      page.locator('[data-wireframe-screen="child-home"]'),
    ).toBeVisible();
  });
});

test("should align a long caption with a height-fitted desktop frame", async ({
  page,
  wireframeLongCaptionDesktopViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto(wireframeLongCaptionDesktopViewerUrl);

  const wireframe = page.locator('[data-wireframe="long-caption-desktop"]');
  await maximizeAfterFrameFit(wireframe);

  expectCaptionContract(await captionContractOf(wireframe), {
    alignmentTolerance: 4,
  });
});

test("should keep a long wireframe caption aligned and readable on mobile", async ({
  page,
  wireframeLongCaptionDesktopViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(wireframeLongCaptionDesktopViewerUrl);

  const wireframe = page.locator('[data-wireframe="long-caption-desktop"]');
  await maximizeAfterFrameFit(wireframe);

  // At phone width there is no slack to hide a misalignment in, so the
  // caption has to land on the frame edge rather than merely near it.
  expectCaptionContract(await captionContractOf(wireframe), {
    alignmentTolerance: 2,
  });
});

test("should keep the wireframe maximize control dormant and the storyboard readable without JavaScript", async ({
  browser,
  wireframeViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(wireframeViewerUrl);

  const frame = page.locator("[data-wireframe]");
  await expect(frame).toBeVisible();
  await expect(frame.locator("[data-figure-maximize]")).toBeHidden();
  await expect(frame).not.toHaveAttribute("data-figure-maximized");
  await expect(
    frame.getByRole("navigation", { name: "Prototype screens" }),
  ).toBeHidden();
  // Every screen remains in the readable storyboard, not just the initial one.
  await expect(
    page.locator('[data-wireframe-screen="loan-lesson"]'),
  ).toBeVisible();

  await context.close();
});

test("should scale a true-size drawing inside a narrow review viewport", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(wireframeViewerUrl);
  const artboard = page.locator(".wireframe-artboard").first();

  await test.step("the artboard keeps device geometry without widening the page", async () => {
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1020);
    const box = await boxOf(artboard);
    expect(box.width).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  await test.step("the drawing scales as a unit instead of reflowing its copy", async () => {
    const fontSize = await artboard.evaluate(
      (node) => getComputedStyle(node).fontSize,
    );
    expect(Number.parseFloat(fontSize)).toBeGreaterThanOrEqual(14);
  });
});

test("should keep each painted desktop screen inside its card", async ({
  page,
  wireframeFormFactorsViewerUrl,
}) => {
  const viewportWidths = [1280, 1440, 1600, 1920];
  const themes = ["light", "dark"];

  for (const viewportWidth of viewportWidths) {
    for (const theme of themes) {
      await test.step(`${viewportWidth}px in ${theme} mode`, async () => {
        await page.setViewportSize({ width: viewportWidth, height: 1000 });
        await page.goto(wireframeFormFactorsViewerUrl);
        await page.evaluate(
          ({ selectedTheme }) => {
            document.documentElement.dataset.theme = selectedTheme;
          },
          { selectedTheme: theme },
        );

        const desktopWireframe = page.locator(
          '[data-wireframe="harbor-desktop"]',
        );
        const screenSwitches = desktopWireframe
          .getByRole("navigation", { name: "Prototype screens" })
          .getByRole("button");

        for (
          let index = 0;
          index < (await screenSwitches.count());
          index += 1
        ) {
          const screenSwitch = screenSwitches.nth(index);
          await screenSwitch.click();
          await expect(screenSwitch).toHaveAttribute("aria-current", "true");

          const overflows = await desktopWireframe
            .locator(
              '.wireframe-screen[data-wireframe-device="desktop"]:visible',
            )
            .evaluateAll((screens) =>
              screens.flatMap((screen) => {
                const frame = screen.querySelector(".wireframe-frame");
                const card = screen.closest(".plan-card");
                if (frame === null || card === null) {
                  return ["desktop screen is missing its frame or card"];
                }

                const frameBox = frame.getBoundingClientRect();
                const cardBox = card.getBoundingClientRect();
                const cardStyle = getComputedStyle(card);
                const innerLeft =
                  cardBox.left +
                  Number.parseFloat(cardStyle.borderLeftWidth) +
                  Number.parseFloat(cardStyle.paddingLeft);
                const innerRight =
                  cardBox.right -
                  Number.parseFloat(cardStyle.borderRightWidth) -
                  Number.parseFloat(cardStyle.paddingRight);
                const tolerance = 1;

                return frameBox.left < innerLeft - tolerance ||
                  frameBox.right > innerRight + tolerance
                  ? [
                      `${screen.getAttribute("data-wireframe-screen")}: ` +
                        `${frameBox.width.toFixed(2)}px painted inside ` +
                        `${(innerRight - innerLeft).toFixed(2)}px`,
                    ]
                  : [];
              }),
            );

          expect(overflows).toEqual([]);
        }
      });
    }
  }
});

test("should preserve the captain's desktop, tablet, and phone measurements", async ({
  page,
  wireframeFormFactorsViewerUrl,
}) => {
  await page.setViewportSize({ width: 2000, height: 1400 });
  await page.goto(wireframeFormFactorsViewerUrl);

  await test.step("desktop drawings use the shared 768px review width", async () => {
    const desktop = page.locator('[data-wireframe-screen="d-ticket"]');
    const artboard = desktop.locator(".wireframe-artboard");
    const card = desktop.locator(".wireframe-frame-card");
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1200);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(820);
    // The reading column caps the page card, not the bare frame, at the
    // shared review width; the card's light border is the outer edge of the
    // page silhouette, and the frame inside it is smaller by the card's own
    // padding and border. A wider tolerance than a bare zoomed frame needs,
    // since the card compounds the frame's fractional CSS zoom with its own
    // fixed-pixel border and padding.
    expect(Math.abs((await boxOf(card)).width - 768)).toBeLessThan(1.5);
  });

  await test.step("landscape tablet drawings hold a real iPad frame", async () => {
    const tablet = page.locator('[data-wireframe-screen="t-inbox"]');
    const artboard = tablet.locator(".wireframe-artboard");
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1020);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(720);
  });

  await test.step("selection does not indent Ticket or Inbox queue rows", async () => {
    const assertAlignedSelection = async (screenId: string): Promise<void> => {
      const desktop = page.locator(`[data-wireframe-screen="${screenId}"]`);
      const selected = desktop.locator(
        ".wireframe-list-item[data-wireframe-selected] .wireframe-list-label",
      );
      const following = desktop
        .locator(".wireframe-list-item:not([data-wireframe-selected])")
        .first()
        .locator(".wireframe-list-label");
      expect((await boxOf(selected)).x).toBeCloseTo(
        (await boxOf(following)).x,
        1,
      );
    };

    await assertAlignedSelection("d-ticket");
    await page
      .getByRole("navigation", { name: "Prototype screens" })
      .first()
      .getByRole("button", { name: "Desktop · Inbox" })
      .click();
    await assertAlignedSelection("d-inbox");
  });

  const phoneSwitcher = page
    .getByRole("navigation", { name: "Prototype screens" })
    .last();

  await test.step("phone controls retain their measured touch targets", async () => {
    await phoneSwitcher.getByRole("button", { name: "Phone · Inbox" }).click();
    const phone = page.locator('[data-wireframe-screen="m-inbox"]');
    await expect(phone).toBeVisible();
    expect(
      (await boxOf(phone.locator(".wireframe-list-item").first())).height,
    ).toBeGreaterThanOrEqual(52);
    expect(
      (await boxOf(phone.getByRole("button", { name: "Filter" }))).height,
    ).toBe(44);
    const tabHeights = await phone
      .locator(".wireframe-bottom-bar .wireframe-button")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
    expect(tabHeights).toEqual([60, 60, 60]);
    expect((await boxOf(phone.locator(".wireframe-bottom-bar"))).height).toBe(
      65,
    );
    await expect(phone.locator(".wireframe-app-shell")).toHaveCount(0);
  });

  await test.step("the rebuilt phone inbox, form, and settings remain intact", async () => {
    const inbox = page.locator('[data-wireframe-screen="m-inbox"]');
    await expect(inbox).toContainText("Saved views");
    await expect(inbox).toContainText("Active filter");
    await expect(inbox.locator(".wireframe-segmented-control")).toHaveCount(1);
    await expect(inbox.locator(".wireframe-list-item")).toHaveCount(7);

    await phoneSwitcher
      .getByRole("button", { name: "Phone · New ticket" })
      .click();
    const form = page.locator('[data-wireframe-screen="m-compose"]');
    await expect(form).toContainText("Attachments");
    await expect(form).toContainText("Possible match");
    await expect(form).toContainText("Additional details");
    await expect(
      form.getByRole("button", { name: "Create ticket" }),
    ).toBeVisible();

    await phoneSwitcher
      .getByRole("button", { name: "Phone · Settings" })
      .click();
    const settings = page.locator('[data-wireframe-screen="m-settings"]');
    await expect(settings).toContainText("Account");
    await expect(settings).toContainText("Notifications");
    await expect(settings).toContainText("Personalization");
    await expect(settings).toContainText("Blocked");
    await expect(
      settings.getByRole("button", { name: "Sign out of Alex Rivera" }),
    ).toBeVisible();

    await settings
      .locator('[data-wireframe-navigate="m-notifications"]')
      .click();
    const notifications = page.locator(
      '[data-wireframe-screen="m-notifications"]',
    );
    await expect(notifications).toBeVisible();
    await expect(
      notifications.getByRole("button", { name: "Open system settings" }),
    ).toBeVisible();
  });
});

test("should keep a short phone artboard native and content-safe", async ({
  page,
  wireframeShortContentViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(wireframeShortContentViewerUrl);
  const artboard = page.locator(".wireframe-artboard");

  expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(720);
  expect(await artboard.evaluate((node) => node.offsetWidth)).toBe(390);
});

test("should keep short page-header actions at the trailing edge", async ({
  page,
  wireframeFormFactorsViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(wireframeFormFactorsViewerUrl);

  await page
    .getByRole("navigation", { name: "Prototype screens" })
    .first()
    .getByRole("button", { name: "Desktop · Inbox" })
    .click();

  const header = page.locator(
    '[data-wireframe-screen="d-inbox"] .wireframe-page-header',
  );
  const geometry = await header.evaluate((node) => {
    const text = node.querySelector(".wireframe-page-header-text");
    const actions = node.querySelector(".wireframe-page-header-actions");
    if (!(text instanceof HTMLElement) || !(actions instanceof HTMLElement)) {
      throw new Error("page header is missing its text or actions group");
    }
    const headerBox = node.getBoundingClientRect();
    const textBox = text.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      headerRight: headerBox.right,
      textRight: textBox.right,
      actionsLeft: actionsBox.left,
      actionsRight: actionsBox.right,
      justifyContent: getComputedStyle(node).justifyContent,
    };
  });

  expect(geometry.justifyContent).toBe("space-between");
  expect(geometry.actionsLeft).toBeGreaterThan(geometry.textRight);
  expect(geometry.actionsRight).toBeCloseTo(geometry.headerRight, 1);
});

// The icon, overlay, and grouping vocabulary is proven in the component slice;
// what only a browser can answer is whether the CSS behind it still holds.
// Each assertion below fences a failure that is silent in the source: a mark
// that keeps its size when the artboard scales, a bar whose two ends stop being
// two ends, a surface that stops covering the page it says is unavailable, and
// an icon-only control that shrinks below the target a finger can hit.
test("should draw marks, a two-ended toolbar, and a surface that covers the page", async ({
  page,
  wireframeChromeViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(wireframeChromeViewerUrl);

  const review = page.locator('[data-wireframe-screen="review"]');

  await test.step("a named mark draws its glyph and a missing one would say so", async () => {
    await expect(
      review.locator('[data-wireframe-icon="terminal"] svg'),
    ).toBeVisible();
    await expect(review.locator("[data-wireframe-icon-unnamed]")).toHaveCount(
      0,
    );
  });

  // The inline icon-with-text containment rule. Its whole point is that a mark
  // beside words is measured against those words, and only a browser that has
  // laid the pair out can say whether it is: the source says 1.15em, and 1.15em
  // of the wrong font-size is exactly the oversized mark this rule replaced.
  await test.step("a mark standing with words is contained to them", async () => {
    const contained = await review.evaluate((root) => {
      const marks = [
        ...root.querySelectorAll("[data-wireframe-glyph-with-text] > svg"),
      ];
      return marks.map((mark) => {
        const words = mark.closest<HTMLElement>(
          ".wireframe-button, .wireframe-icon, .wireframe-reference, .wireframe-list-row-primary",
        );
        if (words === null) {
          throw new Error("inline wireframe glyph has no text-bearing owner");
        }
        const markBox = mark.getBoundingClientRect();
        const wordsBox = words.getBoundingClientRect();
        // An artboard lays out at its true device width and is then scaled as
        // one unit, so a measured rect is in painted pixels while font-size is
        // in the artboard's own. Recovering the scale from the host puts both
        // sides of the ratio in the same units.
        const scale = wordsBox.width / words.offsetWidth;
        return {
          ratio:
            markBox.height /
            (parseFloat(getComputedStyle(words).fontSize) * scale),
          overflows:
            markBox.top < wordsBox.top - 0.5 ||
            markBox.bottom > wordsBox.bottom + 0.5,
        };
      });
    });
    expect(contained.length).toBeGreaterThan(0);
    for (const mark of contained) {
      // Drawn against the words' own size rather than the box around them, and
      // never taller than the line it stands on.
      expect(mark.ratio).toBeCloseTo(1.15, 2);
      expect(mark.overflows).toBe(false);
    }
  });

  await test.step("an icon-only control keeps its words for a screen reader", async () => {
    const copy = review.getByRole("button", { name: "Copy command" });
    await expect(copy).toBeVisible();
    await expect(copy).toHaveText("");
  });

  await test.step("a top bar puts its title at one end and its controls at the other", async () => {
    const bar = review.locator(".wireframe-top-bar");
    const title = boxOf(bar.locator(".wireframe-brand"));
    const actions = boxOf(bar.locator(".wireframe-top-bar-actions"));
    const [titleBox, actionsBox, barBox] = await Promise.all([
      title,
      actions,
      boxOf(bar),
    ]);
    expect(titleBox.x - barBox.x).toBeLessThan(barBox.width / 4);
    expect(actionsBox.x + actionsBox.width).toBeGreaterThan(
      barBox.x + barBox.width * 0.75,
    );
  });

  await test.step("two groups in one row settle at the row's two ends", async () => {
    const row = review.locator(".wireframe-row.justify-between").first();
    const groups = row.locator("> .wireframe-group");
    const [rowBox, first, second] = await Promise.all([
      boxOf(row),
      boxOf(groups.nth(0)),
      boxOf(groups.nth(1)),
    ]);
    expect(first.x - rowBox.x).toBeLessThan(4);
    expect(rowBox.x + rowBox.width - (second.x + second.width)).toBeLessThan(4);
  });

  await test.step("a dimmed overlay covers the page it makes unavailable", async () => {
    await page
      .locator("[data-wireframe-switch]", { hasText: "Delete confirmation" })
      .click();
    const screen = page.locator('[data-wireframe-screen="confirm-delete"]');
    const overlay = screen.locator(".wireframe-overlay");
    await expect(overlay).toHaveAttribute("data-wireframe-backdrop", "dim");
    const [overlayBox, artboardBox] = await Promise.all([
      boxOf(overlay),
      boxOf(screen.locator(".wireframe-artboard")),
    ]);
    // Size alone would pass an overlay the right shape sitting off to one
    // side, which leaves part of the page it calls unavailable exposed.
    expect(overlayBox.width).toBeGreaterThanOrEqual(artboardBox.width - 2);
    expect(overlayBox.height).toBeGreaterThanOrEqual(artboardBox.height - 2);
    expect(overlayBox.x).toBeLessThanOrEqual(artboardBox.x + 2);
    expect(overlayBox.y).toBeLessThanOrEqual(artboardBox.y + 2);
    expect(overlayBox.x + overlayBox.width).toBeGreaterThanOrEqual(
      artboardBox.x + artboardBox.width - 2,
    );
    expect(overlayBox.y + overlayBox.height).toBeGreaterThanOrEqual(
      artboardBox.y + artboardBox.height - 2,
    );
    await expect(
      screen.getByRole("alertdialog", { name: "Delete Checkout rewrite?" }),
    ).toBeVisible();
  });
});

// A push header centres its title in the bar, not in whatever the controls
// left over. Measuring the painted text rather than the box around it is what
// makes this fail when the slot sizing or the alignment goes, which is how the
// pattern was lost silently once already.
const expectCentredTitle = async (bar: TestLocator): Promise<void> => {
  const barBox = await boxOf(bar);
  const titleCentre = await bar.locator(".wireframe-brand").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const painted = range.getBoundingClientRect();
    return painted.left + painted.width / 2;
  });
  expect(
    Math.abs(titleCentre - (barBox.x + barBox.width / 2)),
  ).toBeLessThanOrEqual(barBox.width * 0.02);
};

// A control drawn as one mark has no words to give it size, so its target is
// whatever the stylesheet last said - and a padding change that shrinks it
// below what a finger can hit looks identical in the source and nearly
// identical in the drawing.
test("should hold the touch floor and the leading control on a phone bar", async ({
  page,
  wireframeFormFactorsViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(wireframeFormFactorsViewerUrl);

  const screen = page.locator('[data-wireframe-screen="m-ticket"]');

  await test.step("an icon-only control stays reachable by a finger", async () => {
    const control = screen.locator("[data-wireframe-icon-only]").first();
    const box = await boxOf(control);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // The quiet emphasis draws a link stroke under its words; a control with
    // no words must not draw a rule under its mark instead.
    expect(
      await control.evaluate(
        (node) => getComputedStyle(node, "::before").content,
      ),
    ).toBe("none");
  });

  await test.step("the back control is drawn before the title, as a phone puts it", async () => {
    const bar = screen.locator(".wireframe-top-bar");
    const [leading, title, actions] = await Promise.all([
      boxOf(bar.locator(".wireframe-top-bar-leading")),
      boxOf(bar.locator(".wireframe-brand")),
      boxOf(bar.locator(".wireframe-top-bar-actions")),
    ]);
    expect(leading.x + leading.width).toBeLessThanOrEqual(title.x);
    expect(title.x + title.width).toBeLessThanOrEqual(actions.x);
  });

  await test.step("the title is centred in the bar the reader sees", async () => {
    await expectCentredTitle(screen.locator(".wireframe-top-bar"));
  });

  // The trailing slot is drawn only when the author wrote loose controls, so
  // a bar that carries none is laid out from two slots rather than three. A
  // title centred against its siblings instead of against the bar lands at
  // three quarters of it, and this is the shape that catches that.
  await test.step("a bar carrying nothing trailing centres its title too", async () => {
    await page
      .locator("[data-wireframe-switch]", { hasText: "Phone · Notifications" })
      .click();
    await expectCentredTitle(
      page.locator(
        '[data-wireframe-screen="m-notifications"] .wireframe-top-bar',
      ),
    );
  });
});
