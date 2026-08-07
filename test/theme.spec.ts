// Browser tests of the rendered export's appearance preferences: the document
// follows the OS by default, supports a live explicit mode, and persists one
// global record. Render-health failures are enforced by the fixtures module.

import {
  PREFERENCES_STORAGE_KEY,
  serializePreferencesRecord,
} from "../src/render/preferences.js";
import { expect, test } from "./fixtures";

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
  });

  await test.step("Escape closes and returns focus to the gear", async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open settings" }),
    ).toBeFocused();
  });

  await test.step("Dark applies live and persists one record", async () => {
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
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

test("should recompose settings as a compact bottom sheet on narrow screens", async ({
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
        bottom: rect.bottom,
        optionHeights: options,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.viewportWidth).toBe(width);
    expect(geometry.left).toBe(12);
    expect(geometry.right).toBe(width - 12);
    expect(geometry.bottom).toBe(800);
    expect(geometry.optionHeights).toEqual([68, 68, 68]);
    expect(geometry.documentScrollWidth).toBe(geometry.viewportWidth);
    await page.keyboard.press("Escape");
  }

  await page.setViewportSize({ width: 320, height: 220 });
  await settings.click();
  const shortViewport = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    footerBottom:
      element
        .querySelector("[data-preferences-status]")
        ?.getBoundingClientRect().bottom ?? 0,
    viewportBottom: window.innerHeight,
  }));
  expect(shortViewport.scrollHeight).toBeGreaterThan(
    shortViewport.clientHeight,
  );
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
});

test("should isolate the document while settings is open and restore focus on close", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(sampleViewerUrl);
  const settings = page.getByRole("button", { name: "Open settings" });
  await settings.click();

  const isolation = await page.evaluate(() => {
    const backdrop = document.querySelector("[data-preferences-backdrop]");
    const dialog = document.querySelector("[data-preferences-dialog]");
    return {
      backdropInert: backdrop instanceof HTMLElement && backdrop.inert,
      dialogInert: dialog instanceof HTMLElement && dialog.inert,
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

  expect(isolation).toEqual({
    backdropInert: false,
    dialogInert: false,
    topLevelSiblingsInert: true,
  });

  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toBeFocused();
  await expect(page.locator("[inert]")).toHaveCount(0);
});
