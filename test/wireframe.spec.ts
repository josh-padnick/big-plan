// Browser tests of the wireframe reading journey: the drawing a reviewer
// meets, walking a prototype from one screen to another and back, the
// keyboard route through the same path, and true-size drawings scaling into
// the review surface. Render-health failures are enforced by the fixtures.

import { boxOf, expect, test } from "./fixtures";

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
    const fit = await screen.evaluate((node) => ({
      id: node.getAttribute("data-wireframe-screen"),
      overflow: node.scrollHeight - node.clientHeight,
      zoom: Number.parseFloat(
        getComputedStyle(
          node.querySelector(".wireframe-frame") ?? node,
        ).zoom.toString(),
      ),
    }));
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
