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

  await test.step("the narrow goal card stacks its label and amount cleanly", async () => {
    const goalLine = home.locator(".wireframe-progress-line");
    const geometry = await goalLine.evaluate((node) => {
      const [label, amount] = node.children;
      if (label === undefined || amount === undefined) {
        return null;
      }
      const labelRect = label.getBoundingClientRect();
      const amountRect = amount.getBoundingClientRect();
      return {
        direction: getComputedStyle(node).flexDirection,
        labelBottom: labelRect.bottom,
        amountTop: amountRect.top,
      };
    });
    expect(geometry).not.toBeNull();
    expect(geometry?.direction).toBe("column");
    expect(geometry?.labelBottom ?? 1).toBeLessThanOrEqual(
      geometry?.amountTop ?? 0,
    );
  });

  await test.step("an action inside the drawing moves the prototype", async () => {
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(lesson).toBeVisible();
    await expect(home).toBeHidden();
    await expect(lesson).toContainText("How paying back works");
  });

  await test.step("the screen switcher follows the walk", async () => {
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await expect(
      switcher.getByRole("button", { name: "Lesson · learn" }),
    ).toHaveAttribute("aria-current", "true");
  });

  await test.step("the prototype walks back the way it came", async () => {
    await page
      .getByRole("button", { name: "Try it with my $12 loan", exact: true })
      .click();
    await page.getByRole("button", { name: "$6 is paid back" }).click();
    await page.getByRole("button", { name: "Finish this lesson" }).click();
    await page.getByRole("button", { name: "See my wallet" }).click();
    await expect(home).toBeVisible();
    await expect(lesson).toBeHidden();
  });

  await test.step("the switcher jumps straight to any screen", async () => {
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await switcher.getByRole("button", { name: "Lesson · learn" }).click();
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

test("should separate the child's question, the handoff, authentication, and approval", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);

  await test.step("the child chooses a parallel, concrete branch", async () => {
    await page.getByRole("button", { name: "✋ Ask a grown-up" }).click();
    await expect(
      page.getByRole("button", { name: "⚽ Ask about a purchase" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "💵 Ask about my loan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "💬 Ask about something confusing",
      }),
    ).toBeVisible();
    const optionBoxes = await Promise.all(
      [
        "⚽ Ask about a purchase",
        "💵 Ask about my loan",
        "💬 Ask about something confusing",
      ].map((name) => boxOf(page.getByRole("button", { name }))),
    );
    expect(optionBoxes.map((box) => Math.round(box.x))).toEqual([
      Math.round(optionBoxes[0].x),
      Math.round(optionBoxes[0].x),
      Math.round(optionBoxes[0].x),
    ]);
    expect(optionBoxes.map((box) => Math.round(box.width))).toEqual([
      Math.round(optionBoxes[0].width),
      Math.round(optionBoxes[0].width),
      Math.round(optionBoxes[0].width),
    ]);
    await page.getByRole("button", { name: "⚽ Ask about a purchase" }).click();
  });

  await test.step("the preview only checks the child's question", async () => {
    await page.getByRole("button", { name: "Check my question" }).click();
    const preview = page.locator('[data-wireframe-screen="grown-up-preview"]');
    await expect(preview).toContainText("Check your question");
    await expect(preview).toContainText("“Can I buy a soccer ball for $18?”");
    await expect(
      preview.getByRole("button", { name: "Edit question" }),
    ).toHaveCount(1);
    await expect(
      preview.getByRole("button", { name: "Looks good →" }),
    ).toHaveCount(1);

    const stepLabels = await preview
      .locator(".wireframe-step")
      .allTextContents();
    expect(stepLabels).toEqual(["Choose", "Tell us", "Check", "Handoff"]);
    const completedMarker = await preview
      .locator('.wireframe-step[data-wireframe-step="done"]')
      .first()
      .evaluate((node) => getComputedStyle(node, "::before").content);
    expect(completedMarker).toContain("✓");
    await preview.getByRole("button", { name: "Looks good →" }).click();
  });

  await test.step("the child explicitly hands the device to the adult", async () => {
    const handoff = page.locator(
      '[data-wireframe-screen="grown-up-purchase-handoff"]',
    );
    await expect(handoff).toContainText("Time for your grown-up");
    await expect(handoff).toContainText("Nothing will be bought yet");
    await expect(
      handoff.getByRole("button", { name: "Approve purchase" }),
    ).toHaveCount(0);
    await handoff.getByRole("button", { name: "I'm the grown-up" }).click();
  });

  await test.step("authentication unlocks review without approving", async () => {
    const unlock = page.locator(
      '[data-wireframe-screen="grown-up-purchase-unlock"]',
    );
    await expect(unlock).toContainText("Eddy has a purchase request for you");
    await expect(unlock).toContainText(
      "Unlocking does not approve or buy anything",
    );
    await expect(
      unlock.getByRole("button", { name: "Approve purchase" }),
    ).toHaveCount(0);
    await unlock.getByRole("button", { name: "Unlock to review" }).click();
  });

  await test.step("approval appears only after the full request", async () => {
    const review = page.locator(
      '[data-wireframe-screen="grown-up-purchase-review"]',
    );
    await expect(review).toContainText("Soccer ball · $18");
    await expect(review).toContainText("Balance after purchase: $24.50");
    await expect(
      review.getByRole("button", { name: "Approve purchase" }),
    ).toBeVisible();
  });
});

test("should close the loan lesson with an achievement and real-world recap", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);
  const switcher = page.getByRole("navigation", {
    name: "Prototype screens",
  });
  await switcher.getByRole("button", { name: "Lesson · done" }).click();
  const done = page.locator('[data-wireframe-screen="loan-complete"]');

  await expect(done).toContainText("Nice work, Eddy!");
  await expect(done).toContainText("TWO PAYMENTS LEFT");
  await expect(done).toContainText("Friday payment");
  await expect(done).toContainText("Final Friday payment");
  await expect(done).toContainText(
    "No money moved. Your loan still has $12 left.",
  );
  await done.getByRole("button", { name: "See my wallet" }).click();
  await expect(
    page.locator('[data-wireframe-screen="child-home"]'),
  ).toBeVisible();
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
      .poll(() => artboard.evaluate((node) => node.offsetWidth))
      .toBe(1180);
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

  await test.step("desktop drawings use available width up to the 920px cap", async () => {
    const desktop = page.locator('[data-wireframe-screen="d-ticket"]');
    const wireframe = page.locator('[data-wireframe="harbor-desktop"]');
    const artboard = desktop.locator(".wireframe-artboard");
    const frame = desktop.locator(".wireframe-frame");
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1440);
    expect(
      await artboard.evaluate((node) => node.offsetHeight),
    ).toBeGreaterThanOrEqual(900);
    expect(
      Math.abs(
        (await boxOf(frame)).width -
          Math.min(920, (await boxOf(wireframe)).width),
      ),
    ).toBeLessThanOrEqual(1);
  });

  await test.step("desktop type reads like a normally zoomed application", async () => {
    const artboard = page.locator(
      '[data-wireframe-screen="d-ticket"] .wireframe-artboard',
    );
    const type = await artboard.evaluate((node) => {
      const frame = node.closest(".wireframe-frame");
      const body = node.querySelector(".wireframe-list-item");
      const supporting = node.querySelector(".wireframe-list-meta");
      const title = node.querySelector(
        ".wireframe-page-header .wireframe-heading",
      );
      if (
        frame === null ||
        body === null ||
        supporting === null ||
        title === null
      ) {
        return null;
      }
      const scale = frame.getBoundingClientRect().width / frame.offsetWidth;
      const size = (element: Element): number =>
        Number.parseFloat(getComputedStyle(element).fontSize);
      return {
        authoredBody: size(body),
        authoredSupporting: size(supporting),
        authoredTitle: size(title),
        paintedBody: size(body) * scale,
      };
    });
    expect(type).not.toBeNull();
    expect(type?.authoredBody).toBe(28);
    expect(type?.authoredSupporting).toBe(22);
    expect(type?.authoredTitle).toBe(42);
    expect(type?.paintedBody).toBeGreaterThanOrEqual(14.5);
  });

  await test.step("landscape tablet drawings hold a fixed iPad viewport", async () => {
    const tablet = page.locator('[data-wireframe-screen="t-inbox"]');
    const artboard = tablet.locator(".wireframe-artboard");
    await expect
      .poll(() => artboard.evaluate((node) => node.offsetWidth))
      .toBe(1180);
    expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(820);
    expect(
      await artboard.evaluate((node) => node.offsetWidth / node.offsetHeight),
    ).toBeCloseTo(1.439, 2);
  });

  await test.step("tablet type reads at an idiomatic iPad scale after fitting", async () => {
    const artboard = page.locator(
      '[data-wireframe-screen="t-inbox"] .wireframe-artboard',
    );
    const type = await artboard.evaluate((node) => {
      const frame = node.closest(".wireframe-frame");
      const body = node.querySelector(".wireframe-list-item");
      const supporting = node.querySelector(".wireframe-list-meta");
      const title = node.querySelector(
        ".wireframe-page-header .wireframe-heading",
      );
      if (
        frame === null ||
        body === null ||
        supporting === null ||
        title === null
      ) {
        return null;
      }
      const scale = frame.getBoundingClientRect().width / frame.offsetWidth;
      const size = (element: Element): number =>
        Number.parseFloat(getComputedStyle(element).fontSize);
      return {
        authoredBody: size(body),
        authoredSupporting: size(supporting),
        authoredTitle: size(title),
        paintedBody: size(body) * scale,
      };
    });
    expect(type).not.toBeNull();
    expect(type?.authoredBody).toBe(26);
    expect(type?.authoredSupporting).toBe(20);
    expect(type?.authoredTitle).toBe(44);
    expect(type?.paintedBody).toBeGreaterThanOrEqual(17);
  });

  await test.step("selection does not indent Ticket or overlap Inbox row text", async () => {
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
      const clearance = await selected.evaluate((label) => {
        const item = label.closest(".wireframe-list-item");
        if (item === null) return 0;
        return Number.parseFloat(getComputedStyle(item).paddingLeft);
      });
      expect(clearance).toBeGreaterThanOrEqual(10);
    };

    await assertAlignedSelection("d-ticket");
    await page
      .getByRole("navigation", { name: "Prototype screens" })
      .first()
      .getByRole("button", { name: "Desktop · Inbox" })
      .click();
    const selectedInboxRow = page.locator(
      '[data-wireframe-screen="d-inbox"] .wireframe-table tr[data-wireframe-selected]',
    );
    const firstCell = selectedInboxRow.locator("td").first();
    expect(
      await firstCell.evaluate((cell) =>
        Number.parseFloat(getComputedStyle(cell).paddingLeft),
      ),
    ).toBeGreaterThanOrEqual(10);
    expect(
      await selectedInboxRow.evaluate(
        (row) => row.scrollWidth - row.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });

  await test.step("desktop workspaces stay bounded, scroll by pane, and never overflow sideways", async () => {
    const desktopSwitcher = page
      .getByRole("navigation", { name: "Prototype screens" })
      .first();
    const screens = [
      ["d-ticket", "Desktop · Ticket"],
      ["d-inbox", "Desktop · Inbox"],
      ["d-compose", "Desktop · New ticket"],
      ["d-settings", "Desktop · Settings"],
    ] as const;

    for (const [id, name] of screens) {
      await desktopSwitcher.getByRole("button", { name }).click();
      const screen = page.locator(`[data-wireframe-screen="${id}"]`);
      const artboard = screen.locator(".wireframe-artboard");
      const sidebar = screen.locator(".wireframe-sidebar").first();
      await expect(screen).toBeVisible();
      expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(900);
      expect(
        await artboard.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(await sidebar.evaluate((node) => node.offsetWidth)).toBe(224);
      expect(
        await sidebar.evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).paddingLeft),
        ),
      ).toBeGreaterThanOrEqual(20);
    }

    const ticket = page.locator('[data-wireframe-screen="d-ticket"]');
    await desktopSwitcher
      .getByRole("button", { name: "Desktop · Ticket" })
      .click();
    const queueWidth = (
      await boxOf(ticket.locator('[data-wireframe-span="list"]'))
    ).width;
    const conversationWidth = (
      await boxOf(ticket.locator('[data-wireframe-span="main"]'))
    ).width;
    expect(conversationWidth).toBeGreaterThan(queueWidth);
    await expect(ticket).toContainText("Reply to Maya");
    await expect(ticket).toContainText("Internal note · team only");
    await expect(ticket).toContainText("Customer-visible");
    await expect(ticket).toContainText("⌘↵ send");

    await desktopSwitcher
      .getByRole("button", { name: "Desktop · Settings" })
      .click();
    const settings = page.locator('[data-wireframe-screen="d-settings"]');
    await expect(settings).toContainText("Applies to everyone");
    await expect(settings).toContainText("Applies only to your account");
    await expect(
      settings.locator(".wireframe-switch-state").first(),
    ).toContainText(/On|Off/);
    await expect(settings).toContainText("3 unsaved changes");
  });

  const phoneSwitcher = page
    .getByRole("navigation", { name: "Prototype screens" })
    .last();

  await test.step("phone controls retain their measured touch targets", async () => {
    await phoneSwitcher.getByRole("button", { name: "Phone · Inbox" }).click();
    const phone = page.locator('[data-wireframe-screen="m-inbox"]');
    await expect(phone).toBeVisible();
    const paintedScale = await phone
      .locator(".wireframe-frame")
      .evaluate(
        (node) =>
          node.getBoundingClientRect().width /
          (node instanceof HTMLElement ? node.offsetWidth : 1),
      );
    expect(
      (await boxOf(phone.locator(".wireframe-list-item").first())).height,
    ).toBeGreaterThanOrEqual(52 * paintedScale - 0.5);
    expect(
      (await boxOf(phone.getByRole("button", { name: "Filter" }))).height,
    ).toBeCloseTo(44 * paintedScale, 0);
    const tabHeights = await phone
      .locator(".wireframe-bottom-bar .wireframe-button")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().height),
      );
    for (const height of tabHeights) {
      expect(height).toBeCloseTo(60 * paintedScale, 0);
    }
    expect(
      (await boxOf(phone.locator(".wireframe-bottom-bar"))).height,
    ).toBeCloseTo(65 * paintedScale, 0);
    await expect(phone.locator(".wireframe-app-shell")).toHaveCount(0);
  });

  await test.step("tablet screens use native iPad chrome and no desktop rail", async () => {
    const tablet = page.locator('[data-wireframe-screen="t-inbox"]');
    await expect(tablet.locator(".wireframe-tablet-camera")).toHaveCount(1);
    await expect(tablet.locator(".wireframe-browser-bar")).toHaveCount(0);
    await expect(tablet.locator(".wireframe-sidebar")).toHaveCount(0);
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

test("should keep a short phone state inside a realistic tall silhouette", async ({
  page,
  wireframeShortContentViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(wireframeShortContentViewerUrl);
  const artboard = page.locator(".wireframe-artboard");

  expect(await artboard.evaluate((node) => node.offsetHeight)).toBe(844);
  expect(await artboard.evaluate((node) => node.offsetWidth)).toBe(390);
});

test("should maximize and restore a wireframe in both themes", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(wireframeViewerUrl);

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const wireframe = page.locator("[data-wireframe]").first();
    const trigger = wireframe.locator(
      "[data-wireframe-screen]:visible [data-figure-maximize]",
    );
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAccessibleName("Maximize wireframe");
    await expect(trigger).toHaveText("");
    const before = await boxOf(wireframe.locator(".wireframe-frame:visible"));
    await trigger.scrollIntoViewIfNeeded();
    const scrollBeforeMaximize = await page.evaluate(() => window.scrollY);

    await trigger.click();
    await expect(wireframe).toHaveAttribute("data-figure-maximized", "");
    await expect(trigger).toHaveAccessibleName("Restore wireframe size");
    await expect
      .poll(
        async () =>
          (await boxOf(wireframe.locator(".wireframe-frame:visible"))).width,
      )
      .toBeGreaterThan(before.width);
    const zoomControls = wireframe.locator(
      "[data-wireframe-screen]:visible [data-wireframe-zoom-controls]",
    );
    await expect(zoomControls).toBeVisible();
    const fitted = await boxOf(wireframe.locator(".wireframe-frame:visible"));
    const stage = await boxOf(
      wireframe.locator(
        "[data-wireframe-screen]:visible .wireframe-frame-stage",
      ),
    );
    expect(
      Math.abs(fitted.x + fitted.width / 2 - (stage.x + stage.width / 2)),
    ).toBeLessThanOrEqual(2);

    const screenList = wireframe.getByRole("navigation", {
      name: "Prototype screens",
    });
    await expect(screenList).toBeVisible();
    const currentChoice = screenList.getByRole("button", {
      name: "Wallet",
      exact: true,
    });
    await expect(currentChoice).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      screenList.getByRole("button", { name: "Ask · choose" }),
    ).toBeFocused();
    await expect(
      page.locator('[data-wireframe-screen="grown-up-help"]'),
    ).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect(currentChoice).toBeFocused();
    await expect(
      page.locator('[data-wireframe-screen="child-home"]'),
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(
      screenList.getByRole("button", { name: "Ask · choose" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(currentChoice).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(
      screenList.getByRole("button", { name: "Lesson · done" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(currentChoice).toBeFocused();
    await zoomControls
      .getByRole("button", { name: "Zoom wireframe out" })
      .click();
    await expect(zoomControls).toContainText("75%");
    const zoomedOut = await boxOf(
      wireframe.locator(".wireframe-frame:visible"),
    );
    expect(zoomedOut.width).toBeLessThan(fitted.width * 0.8);
    await zoomControls
      .getByRole("button", { name: "Zoom wireframe in" })
      .click();
    await expect(zoomControls).toContainText("Fit");
    await zoomControls
      .getByRole("button", { name: "Zoom wireframe in" })
      .click();
    await expect(zoomControls).toContainText("125%");
    await expect
      .poll(
        async () =>
          (await boxOf(wireframe.locator(".wireframe-frame:visible"))).width,
      )
      .toBeGreaterThan(fitted.width * 1.2);
    await zoomControls
      .getByRole("button", { name: "Zoom wireframe out" })
      .click();
    await expect(zoomControls).toContainText("Fit");

    await page.keyboard.press("Escape");
    await expect(wireframe).not.toHaveAttribute("data-figure-maximized");
    await expect(trigger).toHaveAccessibleName("Maximize wireframe");
    await expect
      .poll(async () => page.evaluate(() => window.scrollY))
      .toBe(scrollBeforeMaximize);
  }
});

test("should comment on a whole wireframe screen and one specific element", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(wireframeViewerUrl);
  const wireframe = page.locator("[data-wireframe]");
  const screen = page.locator('[data-wireframe-screen="child-home"]');
  const affordance = page.locator("[data-review-affordance]");
  const commentsToggle = page.locator("[data-review-toggle]");

  await test.step("the screen is a registered shared block target", async () => {
    await screen.locator(".wireframe-screen-caption").hover();
    await expect(affordance).toBeHidden();
    await screen
      .getByRole("button", { name: "Comment on this screen" })
      .click();
    await page
      .locator("[data-review-compose-input]")
      .fill("Keep the whole wallet screen calm.");
    await page.locator("[data-review-compose-save]").click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(1);
  });

  await test.step("Comment mode reuses the diagram selection and inline composer", async () => {
    await screen.locator("[data-figure-maximize]").click();
    await expect(commentsToggle).toBeHidden();
    const toolbar = screen.locator(".wireframe-frame-toolbar");
    const frameViewport = screen.locator(".wireframe-frame-viewport");
    const mode = screen.locator("[data-wireframe-comment-mode-toggle]");
    await expect(toolbar).toBeVisible();
    await expect(mode).toBeVisible();
    await expect(mode).toHaveAttribute("aria-checked", "false");
    const toolbarBox = await boxOf(toolbar);
    const viewportBox = await boxOf(frameViewport);
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(viewportBox.y);
    await mode.click();
    await expect(mode).toHaveAttribute("aria-checked", "true");
    await expect(mode).toHaveAccessibleName("Comment Mode, on");
    const action = screen.getByRole("button", {
      name: "✋ Ask a grown-up",
      exact: true,
    });
    await action.hover();
    await expect
      .poll(() =>
        action.evaluate((node) => getComputedStyle(node).outlineStyle),
      )
      .not.toBe("none");
    await action.click();
    await expect(action).toHaveAttribute("data-flow-selected", "");
    const nearbyComment = wireframe
      .locator(".flow-diagram-actionbar")
      .getByRole("button", { name: "Comment" });
    await expect(nearbyComment).toBeVisible();
    const actionBox = await boxOf(action);
    const nearbyBox = await boxOf(nearbyComment);
    expect(Math.abs(nearbyBox.x - actionBox.x)).toBeLessThanOrEqual(240);
    expect(Math.abs(nearbyBox.y - actionBox.y)).toBeLessThanOrEqual(80);
    await nearbyComment.click();
    await page
      .locator(".flow-diagram-compose textarea")
      .fill("Keep this action welcoming.");
    await wireframe
      .locator(".flow-diagram-compose")
      .getByRole("button", { name: "Comment" })
      .click();
    const collector = wireframe.locator(".flow-collector");
    await expect(collector).toBeVisible();
    await expect(collector).toContainText("Keep this action welcoming.");
    const collectorInsets = await Promise.all(
      [
        collector.locator(".flow-collector-head"),
        collector.locator(".flow-collector-list"),
        collector.locator(".flow-collector-foot"),
      ].map((region) =>
        region.evaluate((element) => getComputedStyle(element).paddingLeft),
      ),
    );
    expect(new Set(collectorInsets).size).toBe(1);
    await expect(collector.locator(".flow-collector-item")).toHaveCSS(
      "margin",
      "0px",
    );
    await collector
      .getByRole("button", { name: "Add 1 note to plan feedback" })
      .click();
    await expect(page.locator("[data-review-drafts] li")).toHaveCount(2);
    const ids = await page
      .locator("[data-review-annotated]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.blockId));
    expect(new Set(ids).size).toBe(2);
    await expect(affordance).toBeHidden();
    await mode.click();
    await expect(mode).toHaveAttribute("aria-checked", "false");
    await expect(action).not.toHaveAttribute("data-flow-selected");
  });
});
