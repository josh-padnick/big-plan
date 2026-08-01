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
      .toBe(1112);
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
    const frame = desktop.locator(".wireframe-frame");
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1440);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(900);
    expect((await boxOf(frame)).width).toBeCloseTo(768, 1);
  });

  await test.step("landscape tablet drawings keep a four-by-three minimum", async () => {
    const tablet = page.locator('[data-wireframe-screen="t-inbox"]');
    const artboard = tablet.locator(".wireframe-artboard");
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1112);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(834);
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

test("should keep a short phone artboard content-driven", async ({
  page,
  wireframeShortContentViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(wireframeShortContentViewerUrl);
  const artboard = page.locator(".wireframe-artboard");

  expect(await artboard.evaluate((node) => node.clientHeight)).toBeLessThan(
    400,
  );
  expect(await artboard.evaluate((node) => node.clientWidth)).toBe(390);
});
