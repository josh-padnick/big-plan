// Browser tests of the rendered export's appearance and colour-theme
// preferences: the document follows the OS and warm-paper defaults, supports
// live explicit choices, and persists one global record. Render-health failures
// are enforced by the fixtures module.

import {
  APPROVAL_MESSAGE_STORAGE_KEY,
  DEFAULT_APPROVAL_MESSAGE,
  PREFERENCES_STORAGE_KEY,
  serializePreferencesRecord,
} from "../src/render/preferences.js";
import { expect, test, type Page } from "./fixtures";

// The settings sheet is a sidebar plus one page, so a control is reachable only
// once its section is selected. Every step below opens its own section rather
// than assuming which page happens to be showing.
const openSection = (
  page: Page,
  name: "Appearance" | "Color theme" | "Approval message",
) => page.getByRole("tab", { name, exact: true }).click();

// A colour with no alpha component is fully opaque. The previous pattern
// anchored on the last number before the closing parenthesis, so `rgb(0, 0, 0)`
// matched its blue channel and reported an opaque black as fully transparent.
const backdropOpacity = (color: string): number | null => {
  const alpha = /\/\s*([\d.]+%?)\s*\)$/u.exec(color)?.[1];
  if (alpha !== undefined) {
    return alpha.endsWith("%")
      ? Number(alpha.slice(0, -1)) / 100
      : Number(alpha);
  }
  const legacy = /^rgba?\(([^)]*)\)$/u.exec(color)?.[1];
  if (legacy === undefined) return null;
  const parts = legacy.split(",").map((part) => part.trim());
  const fourth = parts[3];
  if (parts.length === 3) return 1;
  return fourth === undefined ? null : Number(fourth);
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
      // The sidebar stacks above the page it opens rather than beside it, and
      // wraps onto a second row rather than scrolling sideways, so every
      // category stays on screen and the sheet stays one column.
      const sections = Array.from(
        element.querySelectorAll("[data-preferences-section]"),
      ).map((tab) => tab.getBoundingClientRect());
      const panel = element
        .querySelector("[data-preferences-panel]")
        .getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        left: rect.left,
        right: rect.right,
        verticalCenter: (rect.top + rect.bottom) / 2,
        optionHeights: options,
        sectionBottom: Math.max(...sections.map((tab) => tab.bottom)),
        panelTop: panel.top,
        sectionHeights: sections.map((tab) => Math.round(tab.height)),
        sectionRight: Math.max(...sections.map((tab) => tab.right)),
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });

    expect(geometry.viewportWidth).toBe(width);
    expect(geometry.left).toBe(12);
    expect(geometry.right).toBe(width - 12);
    expect(geometry.verticalCenter).toBeCloseTo(geometry.viewportHeight / 2);
    expect(geometry.optionHeights).toEqual([68, 68, 68]);
    expect(geometry.sectionBottom).toBeLessThanOrEqual(geometry.panelTop);
    // Every item is one touch target tall, however many settings the sidebar
    // has grown to hold, and none of them is parked off the sheet's edge.
    expect(new Set(geometry.sectionHeights)).toEqual(new Set([44]));
    expect(geometry.sectionRight).toBeLessThanOrEqual(geometry.right);
    expect(geometry.documentScrollWidth).toBe(geometry.viewportWidth);
    await page.keyboard.press("Escape");
  }

  await test.step("desktop puts the sidebar beside a dominant content pane", async () => {
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
    // A narrow rail beside the page it opens, never two equal columns: the
    // content pane takes the clear majority of the sheet.
    const layout = await dialog.evaluate((element) => {
      const railRect = element
        .querySelector("[data-preferences-sections]")
        .getBoundingClientRect();
      const tabs = Array.from(
        element.querySelectorAll("[data-preferences-section]"),
      ).map((tab) => tab.getBoundingClientRect());
      const pane = element
        .querySelector(
          "[data-preferences-panel]:not([data-preferences-page-hidden])",
        )
        .getBoundingClientRect();
      return {
        railWidth: Math.round(railRect.width),
        paneWidth: Math.round(pane.width),
        railLeftOfPane: railRect.right <= pane.left,
        tabCount: tabs.length,
        tabColumns: new Set(tabs.map((tab) => Math.round(tab.left))).size,
        tabRows: new Set(tabs.map((tab) => Math.round(tab.top))).size,
      };
    });
    expect(layout.railLeftOfPane).toBe(true);
    // One column, one row per setting: the sidebar grows downward beside the
    // page, whatever it has grown to hold.
    expect(layout.tabColumns).toBe(1);
    expect(layout.tabRows).toBe(layout.tabCount);
    expect(layout.paneWidth).toBeGreaterThan(layout.railWidth * 2);
    await openSection(page, "Color theme");
    const themes = await dialog
      .locator("label:has([data-preference-palette])")
      .evaluateAll((options) =>
        options.map((option) => {
          const rect = option.getBoundingClientRect();
          return { left: Math.round(rect.left), top: Math.round(rect.top) };
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
    pageBottom:
      element
        .querySelector(
          "[data-preferences-panel]:not([data-preferences-page-hidden])",
        )
        ?.getBoundingClientRect().bottom ?? 0,
    viewportBottom: window.innerHeight,
  }));
  expect(shortViewport.scrollHeight).toBeGreaterThan(
    shortViewport.clientHeight,
  );
  expect(shortViewport.verticalCenter).toBeCloseTo(110);
  expect(shortViewport.pageBottom).toBeGreaterThan(
    shortViewport.viewportBottom,
  );
  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  // The last of the sheet has to be reachable by scrolling, so the bottom of
  // the settings page it is showing must come inside the viewport. The saving
  // caption used to be the bottom-most thing here; it now sits under the title,
  // where scrolling down takes it off the top and it can prove nothing.
  await expect
    .poll(() =>
      dialog
        .locator("[data-preferences-panel]:not([data-preferences-page-hidden])")
        .evaluate((element) => {
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
    await openSection(page, "Color theme");
    await expect(page.getByRole("radio", { name: "Default" })).toBeChecked();
  });

  const seen = new Map<string, string>();
  for (const mode of ["Light", "Dark"] as const) {
    await openSection(page, "Appearance");
    await page.getByRole("radio", { name: mode }).check();
    await openSection(page, "Color theme");
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
    await openSection(page, "Color theme");
    await expect(page.getByRole("radio", { name: "Brutalist" })).toBeChecked();
    await openSection(page, "Appearance");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  await test.step("returning to Default clears the field and the attribute", async () => {
    await openSection(page, "Color theme");
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
      await openSection(page, "Color theme");
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
  await openSection(page, "Color theme");
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
    await openSection(page, "Appearance");
    await page.getByRole("radio", { name: "Dark" }).check();
    expect((await shape()).slideRadius).toBe("0px");
    await openSection(page, "Color theme");
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
  await openSection(page, "Color theme");
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

test("should navigate settings through a sidebar of separate pages", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PREFERENCES_STORAGE_KEY,
  );
  await page.reload();
  const settings = page.getByRole("button", { name: "Open settings" });
  const appearanceTab = page.getByRole("tab", { name: "Appearance" });
  const paletteTab = page.getByRole("tab", { name: "Color theme" });
  const messageTab = page.getByRole("tab", { name: "Approval message" });
  const appearancePanel = page.locator('[data-preferences-panel="appearance"]');
  const palettePanel = page.locator('[data-preferences-panel="palette"]');
  const messagePanel = page.locator(
    '[data-preferences-panel="approval-message"]',
  );

  await test.step("the sheet opens on the first page with the sidebar focused", async () => {
    await settings.click();
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(appearanceTab).toBeFocused();
    await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
    await expect(appearancePanel).toBeVisible();
    await expect(palettePanel).toBeHidden();
    await expect(messagePanel).toBeHidden();
  });

  await test.step("each page shows only its own controls", async () => {
    await expect(page.getByRole("radio", { name: "System" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Default" })).toBeHidden();
    await paletteTab.click();
    await expect(palettePanel).toBeVisible();
    await expect(appearancePanel).toBeHidden();
    await expect(page.getByRole("radio", { name: "Default" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "System" })).toBeHidden();
    await expect(paletteTab).toHaveAttribute("aria-selected", "true");
    await expect(appearanceTab).toHaveAttribute("aria-selected", "false");
  });

  await test.step("the sidebar is one tab stop and the arrow keys walk it", async () => {
    // A roving tab stop is what lets the sidebar grow without lengthening the
    // trap: however many pages it holds, Tab counts it once.
    await expect(paletteTab).toHaveAttribute("tabindex", "0");
    await expect(appearanceTab).toHaveAttribute("tabindex", "-1");
    await paletteTab.focus();
    await page.keyboard.press("ArrowUp");
    await expect(appearanceTab).toBeFocused();
    await expect(appearancePanel).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(paletteTab).toBeFocused();
    await expect(palettePanel).toBeVisible();
    await page.keyboard.press("Home");
    await expect(appearanceTab).toBeFocused();
    await page.keyboard.press("End");
    await expect(messageTab).toBeFocused();
    await expect(messagePanel).toBeVisible();
    await page.keyboard.press("Home");
    await expect(appearanceTab).toBeFocused();
  });

  await test.step("Tab still wraps inside the dialog with both pages present", async () => {
    const stops: Array<string | null> = [];
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const active = document.activeElement;
          return active === null
            ? null
            : (active.getAttribute("aria-label") ??
                active.textContent?.trim() ??
                null);
        }),
      );
      expect(
        await page.evaluate(
          () =>
            document.activeElement?.closest("[data-preferences-dialog]") !==
            null,
        ),
      ).toBe(true);
    }
    // Three stops in the trap - the sidebar, the page's radio group, and Close
    // - so the fourth Tab is back where the first one landed.
    expect(stops[3]).toBe(stops[0]);
  });
});

test("should hold one settings size while the reviewer changes page", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PREFERENCES_STORAGE_KEY,
  );
  await page.reload();
  const settings = page.getByRole("button", { name: "Open settings" });
  const dialog = page.locator("[data-preferences-dialog]");

  const box = () =>
    dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    });

  // Wide and narrow lay the sheet out differently, so each has to hold its own
  // size; a phone reads the sidebar as a row above the page it opens.
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    for (const mode of ["Light", "Dark"] as const) {
      await settings.click();
      await openSection(page, "Appearance");
      await page.getByRole("radio", { name: mode }).check();
      const onAppearance = await box();
      await openSection(page, "Color theme");
      const onPalette = await box();
      await openSection(page, "Appearance");
      const backOnAppearance = await box();

      expect(onPalette, `${viewport.width}px/${mode} keeps its size`).toEqual(
        onAppearance,
      );
      expect(
        backOnAppearance,
        `${viewport.width}px/${mode} returns to the same size`,
      ).toEqual(onAppearance);
      await page.keyboard.press("Escape");
    }
  }

  await test.step("the pane reserves the room its tallest page needs", async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await settings.click();
    const pages = await dialog.evaluate((element) => {
      const rects = Array.from(
        element.querySelectorAll("[data-preferences-panel]"),
      ).map((panel) => panel.getBoundingClientRect());
      return {
        tops: new Set(rects.map((rect) => Math.round(rect.top))).size,
        lefts: new Set(rects.map((rect) => Math.round(rect.left))).size,
        tallest: Math.max(...rects.map((rect) => rect.height)),
        paneHeight:
          element
            .querySelector("[data-preferences-panel]")
            ?.parentElement?.getBoundingClientRect().height ?? 0,
      };
    });
    // Both pages sit in one cell, so neither can push the other down and the
    // cell is as tall as the taller of them.
    expect(pages.tops).toBe(1);
    expect(pages.lefts).toBe(1);
    expect(Math.round(pages.paneHeight)).toBe(Math.round(pages.tallest));
    await page.keyboard.press("Escape");
  });
});

test("should keep the approval message the reviewer wrote across a reload", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  await page.evaluate(
    (keys) => {
      for (const key of keys) localStorage.removeItem(key);
    },
    [PREFERENCES_STORAGE_KEY, APPROVAL_MESSAGE_STORAGE_KEY],
  );
  await page.reload();
  const settings = page.getByRole("button", { name: "Open settings" });
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  const written = "Start with the migration and check in before the cutover.";

  await test.step("the page opens on the wording an approval would carry", async () => {
    await settings.click();
    await openSection(page, "Approval message");
    await expect(message).toBeVisible();
    await expect(message).toHaveValue(DEFAULT_APPROVAL_MESSAGE);
    // The pages are peers: opening this one puts the other two away.
    await expect(page.getByRole("radio", { name: "System" })).toBeHidden();
    await expect(page.getByRole("radio", { name: "Default" })).toBeHidden();
  });

  await test.step("a written message survives a reload", async () => {
    await message.fill(written);
    await page.keyboard.press("Escape");
    await page.reload();
    await settings.click();
    await openSection(page, "Approval message");
    await expect(message).toHaveValue(written);
  });

  await test.step("emptying the field shows the wording an approval would carry", async () => {
    // A blank note is not a covering note, so it removes the record rather
    // than storing one. Reopening the sheet has to show what that record now
    // resolves to, not the blank text the reviewer left behind.
    await message.fill("   ");
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        APPROVAL_MESSAGE_STORAGE_KEY,
      ),
    ).toBeNull();
    await page.keyboard.press("Escape");
    await settings.click();
    await openSection(page, "Approval message");
    await expect(message).toHaveValue(DEFAULT_APPROVAL_MESSAGE);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        APPROVAL_MESSAGE_STORAGE_KEY,
      ),
    ).toBeNull();
  });

  await test.step("Reset to default restores the standard wording, and that survives too", async () => {
    await page.getByRole("button", { name: "Reset to default" }).click();
    await expect(message).toHaveValue(DEFAULT_APPROVAL_MESSAGE);
    await expect(message).toBeFocused();
    // The default is what absence means, so resetting leaves nothing stored.
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        APPROVAL_MESSAGE_STORAGE_KEY,
      ),
    ).toBeNull();
    await page.reload();
    await settings.click();
    await openSection(page, "Approval message");
    await expect(message).toHaveValue(DEFAULT_APPROVAL_MESSAGE);
  });

  await test.step("a stored note the contract cannot honour shows as the default", async () => {
    // The delivered settings script carries its own copy of the fail-closed
    // rule, because a script inside a template string imports nothing. Seed
    // each way a record can be unusable and assert the field still offers a
    // note to send rather than an empty box or a truncated one.
    for (const corrupt of [
      "not json",
      '{"version":2,"message":"from a future build"}',
      '{"version":1,"message":7}',
      '{"version":1,"message":"   "}',
    ]) {
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [APPROVAL_MESSAGE_STORAGE_KEY, corrupt],
      );
      await page.reload();
      await settings.click();
      await openSection(page, "Approval message");
      await expect(message, `storage: ${corrupt}`).toHaveValue(
        DEFAULT_APPROVAL_MESSAGE,
      );
      await page.keyboard.press("Escape");
    }
  });

  await test.step("the appearance choice still applies and persists beside it", async () => {
    await settings.click();
    await openSection(page, "Appearance");
    await page.getByRole("radio", { name: "Dark" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test("should open settings on the page an approve dialog asks for", async ({
  page,
  sampleViewerUrl,
}) => {
  // The review island's "Edit message" dispatches this event so the reviewer
  // lands on the field instead of hunting the sidebar for it.
  await page.goto(sampleViewerUrl);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    APPROVAL_MESSAGE_STORAGE_KEY,
  );
  await page.reload();
  const openOnCategory = (category: string) =>
    page.evaluate(
      (name) =>
        document.dispatchEvent(
          new CustomEvent("bigplan:open-settings", {
            detail: { category: name },
          }),
        ),
      category,
    );

  await openOnCategory("approval-message");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Approval message" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeFocused();

  await test.step("a second ask moves the open sheet to that page", async () => {
    await openOnCategory("appearance");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Appearance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
