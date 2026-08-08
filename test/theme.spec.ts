// Browser tests of the rendered export's appearance and colour-theme
// preferences: the document follows the OS and warm-paper defaults, supports
// live explicit choices, and persists one global record. Render-health failures
// are enforced by the fixtures module.

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
      .toBe(serializePreferencesRecord({ mode: "dark", palette: "default" }));
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
      .toBe(serializePreferencesRecord({ mode: "system", palette: "default" }));
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
      const options = Array.from(
        element.querySelectorAll("[data-preference-mode]"),
      ).map((option) => option.closest("label").getBoundingClientRect().height);
      const themes = Array.from(
        element.querySelectorAll("[data-preference-palette]"),
      ).map((option) => option.closest("label").getBoundingClientRect());
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        left: rect.left,
        right: rect.right,
        verticalCenter: (rect.top + rect.bottom) / 2,
        optionHeights: options,
        themeCount: themes.length,
        themeRight: Math.max(...themes.map((theme) => theme.right)),
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.viewportWidth).toBe(width);
    expect(geometry.left).toBe(12);
    expect(geometry.right).toBe(width - 12);
    expect(geometry.verticalCenter).toBeCloseTo(geometry.viewportHeight / 2);
    expect(geometry.optionHeights).toEqual([68, 68, 68]);
    expect(geometry.themeCount).toBe(5);
    expect(geometry.themeRight).toBeLessThanOrEqual(geometry.right);
    expect(geometry.documentScrollWidth).toBe(geometry.viewportWidth);
    await page.keyboard.press("Escape");
  }

  await test.step("desktop keeps three appearance cards and one theme column", async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await settings.click();
    const cards = await dialog
      .locator("label:has([data-preference-mode])")
      .evaluateAll((options) =>
        options.map((option) => {
          const rect = option.getBoundingClientRect();
          return { height: rect.height, left: rect.left, top: rect.top };
        }),
      );
    expect(cards.map(({ height }) => height)).toEqual([112, 112, 112]);
    expect(new Set(cards.map(({ left }) => left)).size).toBe(3);
    expect(new Set(cards.map(({ top }) => top)).size).toBe(1);
    const themes = await dialog
      .locator("label:has([data-preference-palette])")
      .evaluateAll((options) =>
        options.map((option) => {
          const rect = option.getBoundingClientRect();
          return { left: rect.left, top: rect.top };
        }),
      );
    expect(themes).toHaveLength(5);
    expect(new Set(themes.map(({ left }) => left)).size).toBe(1);
    expect(new Set(themes.map(({ top }) => top)).size).toBe(5);
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
    const backdropAlpha =
      backdropStyle === null
        ? null
        : (/(?:\/|,)\s*([\d.]+)\s*\)?$/u.exec(
            backdropStyle.backgroundColor,
          )?.[1] ?? null);
    return {
      backdropInert: backdrop instanceof HTMLElement && backdrop.inert,
      dialogInert: dialog instanceof HTMLElement && dialog.inert,
      backdropIsDimmed:
        backdropStyle !== null &&
        backdropStyle.backgroundColor !== "rgba(0, 0, 0, 0)",
      backdropOpacity: backdropAlpha === null ? null : Number(backdropAlpha),
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

test("should repaint the whole document from the colour-theme row", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.goto(allComponentsViewerUrl);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PREFERENCES_STORAGE_KEY,
  );
  await page.reload();
  const settings = page.getByRole("button", { name: "Open settings" });

  // One sample of each thing a theme has to reach: the page itself, prose, a
  // heading, a link, a code token, a callout, and a table band.
  const surfaces = () =>
    page.evaluate(() => {
      const colorOf = (selector, property) => {
        const element = document.querySelector(selector);
        return element === null
          ? null
          : getComputedStyle(element)[property as "color"];
      };
      return {
        page: colorOf("body", "backgroundColor"),
        prose: colorOf("article p", "color"),
        heading: colorOf("article h2", "color"),
        link: colorOf("article a[href]", "color"),
        code: colorOf("article .hljs-keyword", "color"),
        callout: colorOf("[data-callout]", "backgroundColor"),
        tableHead: colorOf("article table th", "backgroundColor"),
        sidebar: colorOf("[data-section-link]", "color"),
      };
    });

  await test.step("Default is the first-run theme and carries no attribute", async () => {
    await expect(page.locator("html")).not.toHaveAttribute("data-palette");
    await settings.click();
    await expect(page.getByRole("radio", { name: "Default" })).toBeChecked();
  });

  const seen = new Map<string, string>();
  for (const mode of ["Light", "Dark"] as const) {
    await page.getByRole("radio", { name: mode }).check();
    for (const theme of [
      { title: "Default", id: null },
      { title: "Rosé Pine", id: "rose-pine" },
      { title: "Nord", id: "nord" },
      { title: "Catppuccin", id: "catppuccin" },
      { title: "Brutalist", id: "brutalist" },
    ]) {
      await page.getByRole("radio", { name: theme.title }).check();
      if (theme.id === null) {
        await expect(page.locator("html")).not.toHaveAttribute("data-palette");
      } else {
        await expect(page.locator("html")).toHaveAttribute(
          "data-palette",
          theme.id,
        );
      }
      const painted = await surfaces();
      for (const [surface, color] of Object.entries(painted)) {
        expect(
          color,
          `${theme.title}/${mode} paints ${surface}`,
        ).not.toBeNull();
      }
      seen.set(`${mode}/${theme.title}`, JSON.stringify(painted));
    }
  }

  await test.step("every theme and mode paints a distinct document", async () => {
    expect(new Set(seen.values()).size).toBe(seen.size);
  });

  await test.step("the choice survives a reload without a wrong-theme frame", async () => {
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe(serializePreferencesRecord({ mode: "dark", palette: "brutalist" }));
    await page.reload();
    // The head script runs before the first paint, so the attributes are
    // already right when the document body is first parsed.
    const atFirstBody = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      palette: document.documentElement.getAttribute("data-palette"),
    }));
    expect(atFirstBody).toEqual({ theme: "dark", palette: "brutalist" });
    await settings.click();
    await expect(page.getByRole("radio", { name: "Brutalist" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  await test.step("returning to Default clears the field and the attribute", async () => {
    await page.getByRole("radio", { name: "Default" }).check();
    await expect(page.locator("html")).not.toHaveAttribute("data-palette");
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          PREFERENCES_STORAGE_KEY,
        ),
      )
      .toBe(serializePreferencesRecord({ mode: "dark", palette: "default" }));
  });

  // Cole and Everforest were offered before the captain replaced them, so a
  // browser that still holds one takes the same route a corrupt record takes.
  await test.step("an unknown or withdrawn stored theme falls back to the product palette", async () => {
    for (const palette of ["solarized", "cole", "everforest"]) {
      await page.evaluate(
        ([key, value]) =>
          localStorage.setItem(
            key,
            `{"version":1,"mode":"dark","palette":"${value}"}`,
          ),
        [PREFERENCES_STORAGE_KEY, palette] as const,
      );
      await page.reload();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      await expect(page.locator("html")).not.toHaveAttribute("data-palette");
      await settings.click();
      await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
      await expect(page.getByRole("radio", { name: "Default" })).toBeChecked();
      await page.keyboard.press("Escape");
    }
  });
});

test("should make Brutalist a change of shape, not only of hue", async ({
  page,
  allComponentsViewerUrl,
}) => {
  await page.goto(allComponentsViewerUrl);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PREFERENCES_STORAGE_KEY,
  );
  await page.reload();

  const shape = () =>
    page.evaluate(() => {
      const of = (selector: string, property: string) => {
        const element = document.querySelector(selector);
        return element === null
          ? null
          : getComputedStyle(element)[property as "borderRadius"];
      };
      return {
        slideRadius: of("[data-slide]", "borderRadius"),
        slideShadow: of("[data-slide]", "boxShadow"),
        codeRadius: of("article pre", "borderRadius"),
        calloutRadius: of("[data-callout]", "borderRadius"),
        decisionInputRadius: of(".decision-proposal-input", "borderRadius"),
        decisionButtonRadius: of(".decision-confirm", "borderRadius"),
        headingWeight: of("article h2", "fontWeight"),
      };
    });

  const settings = page.getByRole("button", { name: "Open settings" });
  await settings.click();
  await page.getByRole("radio", { name: "Light" }).check();
  const soft = await shape();
  await page.getByRole("radio", { name: "Brutalist" }).check();
  const stark = await shape();

  expect(soft.slideRadius).not.toBe("0px");
  expect(stark.slideRadius).toBe("0px");
  expect(stark.codeRadius).toBe("0px");
  expect(stark.calloutRadius).toBe("0px");
  expect(soft.decisionInputRadius).not.toBe("0px");
  expect(stark.decisionInputRadius).toBe("0px");
  expect(soft.decisionButtonRadius).not.toBe("0px");
  expect(stark.decisionButtonRadius).toBe("0px");
  // A hard offset slab rather than a soft multi-layer shadow: every remaining
  // shadow step is zero-blur.
  expect(soft.slideShadow).not.toBe(stark.slideShadow);
  expect(stark.slideShadow).toMatch(/2px 2px 0px 0px/u);
  expect(Number(stark.headingWeight)).toBeGreaterThan(
    Number(soft.headingWeight),
  );

  await test.step("the shape follows the theme into dark and back out again", async () => {
    await page.getByRole("radio", { name: "Dark" }).check();
    expect((await shape()).slideRadius).toBe("0px");
    await page.getByRole("radio", { name: "Nord" }).check();
    const nord = await shape();
    expect(nord.slideRadius).toBe(soft.slideRadius);
    expect(nord.headingWeight).toBe(soft.headingWeight);
  });
});

test("should preview each theme in its own colours inside the sheet", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(sampleViewerUrl);
  await page.getByRole("button", { name: "Open settings" }).click();
  const defaultInk = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).color);
  await page.getByRole("radio", { name: "Rosé Pine" }).check();
  const documentInk = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).color);

  const strips = await page
    .locator("[data-palette-swatch]")
    .evaluateAll((swatches) =>
      swatches.map((swatch) => ({
        palette: swatch.getAttribute("data-palette"),
        chips: Array.from(swatch.children).map(
          (chip) => getComputedStyle(chip).backgroundColor,
        ),
      })),
    );

  expect(strips.map(({ palette }) => palette)).toEqual([
    "default",
    "rose-pine",
    "nord",
    "catppuccin",
    "brutalist",
  ]);
  for (const strip of strips) {
    expect(strip.chips, `${strip.palette} shows four shades`).toHaveLength(4);
  }
  const inkChips = strips.map(({ chips }) => chips[3]);
  expect(new Set(inkChips).size).toBe(5);
  expect(inkChips[0]).toBe(defaultInk);
  expect(inkChips[1]).toBe(documentInk);
  expect(inkChips[0]).not.toBe(documentInk);
  // A swatch reads its own theme's ramps, so no two strips agree even though
  // the document behind the sheet is painted in one of them.
  expect(new Set(strips.map(({ chips }) => chips.join("|"))).size).toBe(5);
});
