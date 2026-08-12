// Browser tests of the rendered export's appearance preferences: the document
// follows the OS by default, supports a live explicit mode, and persists one
// global record. Render-health failures are enforced by the fixtures module.

import {
  PREFERENCES_STORAGE_KEY,
  serializePreferencesRecord,
} from "../src/render/preferences.js";
import { expect, test } from "./fixtures";

const backdropOpacity = (color: string): number | null => {
  const match = /(?:\/|,)\s*([\d.]+)\s*\)?$/u.exec(color);
  return match?.[1] === undefined ? null : Number(match[1]);
};

test("should choose and persist appearance from the settings dialog", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(sampleViewerUrl);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PREFERENCES_STORAGE_KEY,
  );
  await page.reload();

  await test.step("System is the first-run value", async () => {
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(
      page.getByRole("button", { name: "Open settings" }),
    ).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
    await expect
      .poll(async () =>
        backdropOpacity(
          await page
            .locator("[data-preferences-backdrop]")
            .evaluate((backdrop) => getComputedStyle(backdrop).backgroundColor),
        ),
      )
      .toBe(0.7);
  });

  await test.step("Escape closes and returns focus to the gear", async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open settings" }),
    ).toBeFocused();
    await expect(page.getByRole("button", { name: "Open settings" })).toHaveCSS(
      "outline-style",
      "none",
    );
  });

  await test.step("Dark applies live and persists one record", async () => {
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(async () =>
        backdropOpacity(
          await page
            .locator("[data-preferences-backdrop]")
            .evaluate((backdrop) => getComputedStyle(backdrop).backgroundColor),
        ),
      )
      .toBe(0.8);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe(serializePreferencesRecord("dark"));
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  await test.step("System removes the override and follows the OS", async () => {
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("radio", { name: "System" }).check();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe(serializePreferencesRecord("system"));
    const lightBackground = await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).backgroundColor);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() =>
        page
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundColor),
      )
      .not.toBe(lightBackground);
  });

  await test.step("Tab stays inside the dialog", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open settings" }).click();
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab");
      await expect(page.locator("[data-preferences-dialog]")).toContainText(
        "Appearance",
      );
      expect(
        await page.evaluate(
          () =>
            document.activeElement?.closest("[data-preferences-dialog]") !==
            null,
        ),
      ).toBe(true);
    }
  });
});

test("should recompose settings as a centered sheet on narrow screens", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(sampleViewerUrl);
  const settings = page.getByRole("button", { name: "Open settings" });
  const dialog = page.locator("[data-preferences-dialog]");
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await settings.click();
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const options = Array.from(element.querySelectorAll("label")).map(
        (option) => option.getBoundingClientRect().height,
      );
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        left: rect.left,
        right: rect.right,
        verticalCenter: (rect.top + rect.bottom) / 2,
        optionHeights: options,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.viewportWidth).toBe(width);
    expect(geometry.left).toBe(12);
    expect(geometry.right).toBe(width - 12);
    expect(geometry.verticalCenter).toBeCloseTo(geometry.viewportHeight / 2);
    expect(geometry.optionHeights).toEqual([68, 68, 68]);
    expect(geometry.documentScrollWidth).toBe(geometry.viewportWidth);
    await page.keyboard.press("Escape");
  }

  await test.step("desktop keeps the three appearance cards", async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await settings.click();
    const cards = await dialog.locator("label").evaluateAll((options) =>
      options.map((option) => {
        const rect = option.getBoundingClientRect();
        return { height: rect.height, left: rect.left, top: rect.top };
      }),
    );
    expect(cards.map(({ height }) => height)).toEqual([112, 112, 112]);
    expect(new Set(cards.map(({ left }) => left)).size).toBe(3);
    expect(new Set(cards.map(({ top }) => top)).size).toBe(1);
    await page.keyboard.press("Escape");
  });

  await page.setViewportSize({ width: 320, height: 220 });
  await settings.click();
  const shortViewport = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    verticalCenter: (() => {
      const rect = element.getBoundingClientRect();
      return (rect.top + rect.bottom) / 2;
    })(),
    footerBottom:
      element
        .querySelector("[data-preferences-status]")
        ?.getBoundingClientRect().bottom ?? 0,
    viewportBottom: window.innerHeight,
  }));
  expect(shortViewport.scrollHeight).toBeGreaterThan(
    shortViewport.clientHeight,
  );
  expect(shortViewport.verticalCenter).toBeCloseTo(110);
  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      dialog.locator("[data-preferences-status]").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom <= window.innerHeight;
      }),
    )
    .toBe(true);

  await test.step("nonzero safe areas constrain and recenter the sheet", async () => {
    await page.keyboard.press("Escape");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 24, bottom: 34, left: 0, right: 0 },
    });
    await settings.click();
    const safeArea = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const backdrop = element.parentElement;
      const backdropStyle =
        backdrop instanceof HTMLElement ? getComputedStyle(backdrop) : null;
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        center: (rect.top + rect.bottom) / 2,
        paddingTop: backdropStyle?.paddingTop,
        paddingBottom: backdropStyle?.paddingBottom,
      };
    });
    expect(safeArea).toEqual({
      top: 36,
      bottom: 174,
      height: 138,
      center: 105,
      paddingTop: "24px",
      paddingBottom: "34px",
    });
    await cdp.detach();
  });
});

test("should isolate the document while settings is open and restore focus on close", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(sampleViewerUrl);
  const settings = page.getByRole("button", { name: "Open settings" });
  const slide = page.locator("[data-slide]").first();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const commentDraft = page.getByRole("dialog", { name: /Comment on/ });
  await expect(commentDraft).toBeVisible();
  await settings.click();

  const isolation = await page.evaluate(() => {
    const backdrop = document.querySelector("[data-preferences-backdrop]");
    const dialog = document.querySelector("[data-preferences-dialog]");
    const backdropStyle =
      backdrop instanceof HTMLElement ? getComputedStyle(backdrop) : null;
    return {
      backdropInert: backdrop instanceof HTMLElement && backdrop.inert,
      dialogInert: dialog instanceof HTMLElement && dialog.inert,
      backdropIsDimmed:
        backdropStyle !== null &&
        backdropStyle.backgroundColor !== "rgba(0, 0, 0, 0)",
      backdropColor: backdropStyle?.backgroundColor ?? null,
      topLevelSiblingsInert:
        backdrop instanceof HTMLElement
          ? Array.from(document.body.children)
              .filter((element) => element !== backdrop)
              .every((element) =>
                element instanceof HTMLElement ? element.inert : true,
              )
          : false,
    };
  });

  const { backdropColor, ...isolationState } = isolation;
  expect({
    ...isolationState,
    backdropOpacity:
      backdropColor === null ? null : backdropOpacity(backdropColor),
  }).toEqual({
    backdropInert: false,
    dialogInert: false,
    backdropIsDimmed: true,
    backdropOpacity: 0.7,
    topLevelSiblingsInert: true,
  });
  expect(
    await commentDraft.evaluate(
      (element) => element.closest("[inert]") !== null,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toBeFocused();
  await expect(commentDraft).toBeVisible();
  await expect(page.locator("[inert]")).toHaveCount(0);

  await settings.click();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await expect(commentDraft).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await settings.click();
  await expect
    .poll(async () =>
      backdropOpacity(
        await page
          .locator("[data-preferences-backdrop]")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      ),
    )
    .toBe(0.8);
});

test("should apply every appearance row under light and dark OS schemes", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(sampleViewerUrl);
  const settings = page.getByRole("button", { name: "Open settings" });

  const palettes = new Map<string, string>();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const option of [
      { mode: "light", title: "Light", copy: "Always light", dim: 0.7 },
      { mode: "dark", title: "Dark", copy: "Always dark", dim: 0.8 },
      {
        mode: "system",
        title: "System",
        copy: "Match device",
        dim: colorScheme === "dark" ? 0.8 : 0.7,
      },
    ] as const) {
      if (!(await page.getByRole("dialog").isVisible())) {
        await settings.click();
      }
      await page.getByText(option.copy, { exact: true }).click();
      await expect(
        page.getByRole("radio", { name: option.title }),
      ).toBeChecked();
      if (option.mode === "system") {
        await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      } else {
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          option.mode,
        );
      }
      const appearance = await page.evaluate(() => {
        const backdrop = document.querySelector("[data-preferences-backdrop]");
        const opacity =
          backdrop instanceof HTMLElement
            ? getComputedStyle(backdrop).backgroundColor.match(
                /\/\s*([\d.]+)\s*\)$/,
              )?.[1]
            : undefined;
        return {
          background: getComputedStyle(document.body).backgroundColor,
          dim: opacity === undefined ? null : Number(opacity),
        };
      });
      palettes.set(`${colorScheme}-${option.mode}`, appearance.background);
      expect(appearance.dim).toBe(option.dim);
    }
    await page.keyboard.press("Escape");
  }

  expect(palettes.get("light-light")).toBe(palettes.get("dark-light"));
  expect(palettes.get("light-dark")).toBe(palettes.get("dark-dark"));
  expect(palettes.get("light-system")).toBe(palettes.get("light-light"));
  expect(palettes.get("dark-system")).toBe(palettes.get("dark-dark"));
});
