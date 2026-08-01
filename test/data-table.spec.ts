// Browser tests of DataTable interaction sequences whose outcome depends on
// state shared across sorting, grouping, filtering, and figure controls.

import { expect, test } from "./fixtures";

test("should keep every table-chrome focus state subtle in every palette", async ({
  page,
  dataTableViewerUrl,
}) => {
  await page.goto(dataTableViewerUrl);
  const table = page.locator("[data-data-table]").filter({
    hasText: "Queue depth by processor",
  });
  const filter = table.getByRole("searchbox", { name: "Filter rows" });
  const header = table.locator(".data-table-header");
  const paletteCases = [
    {
      name: "default light",
      theme: undefined,
      colorScheme: "light" as const,
      border: "rgb(201, 193, 174)",
      chrome: "rgb(236, 231, 219)",
      accent: "rgb(22, 101, 52)",
    },
    {
      name: "system dark",
      theme: undefined,
      colorScheme: "dark" as const,
      border: "rgb(79, 74, 63)",
      chrome: "rgb(51, 46, 36)",
      accent: "rgb(130, 201, 154)",
    },
    {
      name: "explicit dark",
      theme: "dark",
      colorScheme: "light" as const,
      border: "rgb(79, 74, 63)",
      chrome: "rgb(51, 46, 36)",
      accent: "rgb(130, 201, 154)",
    },
  ];
  const tabTo = async (target: typeof filter) => {
    for (let index = 0; index < 20; index += 1) {
      if (
        await target.evaluate((element) => document.activeElement === element)
      ) {
        return;
      }
      await page.keyboard.press("Tab");
    }
    throw new Error("Tab order did not reach the expected DataTable control");
  };
  const expectSoftHalo = async (target: typeof filter) => {
    await expect(target).toHaveCSS("outline-style", "none");
    await expect
      .poll(() =>
        target.evaluate((element) => getComputedStyle(element).boxShadow),
      )
      .not.toBe("none");
  };

  for (const paletteCase of paletteCases) {
    await test.step(paletteCase.name, async () => {
      await page.emulateMedia({ colorScheme: paletteCase.colorScheme });
      await page.evaluate((theme) => {
        if (theme === undefined) {
          document.documentElement.removeAttribute("data-theme");
          return;
        }
        document.documentElement.dataset["theme"] = theme;
      }, paletteCase.theme);

      await header.click({ position: { x: 2, y: 2 } });
      await expect(filter).toHaveCSS("border-top-color", paletteCase.border);
      await expect(header).toHaveCSS("background-color", paletteCase.chrome);

      await filter.click();
      await expect(filter).toBeFocused();
      await expect(filter).toHaveCSS("border-top-color", paletteCase.accent);
      await expectSoftHalo(filter);

      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(filter).toBeFocused();
      await expect(filter).toHaveCSS("border-top-color", paletteCase.accent);
      await expectSoftHalo(filter);

      const focusTargets = [
        table.getByRole("button", { name: "Choose columns" }),
        table.getByRole("button", { name: "Text fit" }),
        table.getByRole("button", { name: "Reset table layout" }),
        table.getByRole("button", { name: "Maximize table" }),
        table.getByRole("button", { name: "Processor" }),
      ];
      for (const target of focusTargets) {
        await tabTo(target);
        await expect(target).toBeFocused();
        await expectSoftHalo(target);
      }

      await filter.click();
      await page.keyboard.press("Tab");
      const columnsButton = table.getByRole("button", {
        name: "Choose columns",
      });
      await expect(columnsButton).toBeFocused();
      await page.keyboard.press("Enter");
      const menuItem = table.getByRole("menuitemcheckbox", {
        name: "Attempts",
      });
      await expect(menuItem).toBeFocused();
      await expectSoftHalo(menuItem);
      await page.keyboard.press("Escape");
    });
  }
});

test("should restore authored group order when resetting a regrouped table", async ({
  page,
  dataTableViewerUrl,
}) => {
  await page.goto(dataTableViewerUrl);
  const table = page.locator("[data-data-table]").filter({
    hasText: "Retry policy by tier",
  });
  const columnsButton = table.getByRole("button", {
    name: "Choose columns",
  });

  await columnsButton.click();
  await table.getByRole("menuitemradio", { name: "No grouping" }).click();
  await columnsButton.click();
  const tierSort = table.getByRole("button", { name: "Tier" });
  await tierSort.click();
  await tierSort.click();
  await expect(tierSort.locator("..")).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await columnsButton.click();
  await table.getByRole("menuitemradio", { name: "Tier" }).click();

  await table.getByRole("button", { name: "Reset table layout" }).click();

  await expect(table.locator("[data-table-group-heading]")).toHaveText([
    "Enterprise",
    "Standard",
  ]);
});

test("should preserve generous separation before visible group bands when sorting and filtering", async ({
  page,
  dataTableViewerUrl,
}) => {
  await page.goto(dataTableViewerUrl);
  const table = page.locator("[data-data-table]").filter({
    hasText: "Retry policy by tier",
  });
  const groupEnds = table.locator("tr[data-table-group-end]");
  const separatedBands = table.locator(
    "tr[data-table-group-end] + tr.data-table-group-row:not([hidden])",
  );
  const groupEndRows = () =>
    groupEnds.evaluateAll((rows) =>
      rows.map((row) => ({
        group: row.getAttribute("data-table-group"),
        failure:
          row.querySelector('[data-table-column="1"]')?.textContent?.trim() ??
          "",
      })),
    );

  await expect(separatedBands).toHaveCount(1);
  await expect(groupEnds.locator("td").first()).toHaveCSS(
    "padding-bottom",
    "40px",
  );
  await expect
    .poll(groupEndRows)
    .toEqual([{ group: "Enterprise", failure: "Processor timeout" }]);

  await table.getByRole("button", { name: "Failure" }).click();

  await expect(separatedBands).toHaveCount(1);
  await expect
    .poll(groupEndRows)
    .toEqual([{ group: "Enterprise", failure: "Processor timeout" }]);

  const filter = table.getByRole("searchbox", { name: "Filter rows" });
  await filter.fill("processor");

  await expect(table.locator("[data-table-group-heading]:visible")).toHaveText([
    "Enterprise",
    "Standard",
  ]);
  await expect(separatedBands).toHaveCount(1);
  await expect(groupEnds.locator("td").first()).toHaveCSS(
    "padding-bottom",
    "40px",
  );

  await filter.fill("network");

  await expect(table.locator("[data-table-group-heading]:visible")).toHaveText([
    "Standard",
  ]);
  await expect(groupEnds).toHaveCount(0);
});

test("should restore a maximized table when filter Escape has no work", async ({
  page,
  dataTableViewerUrl,
}) => {
  await page.goto(dataTableViewerUrl);
  const table = page.locator("[data-data-table]").filter({
    hasText: "Queue depth by processor",
  });
  const filter = table.getByRole("searchbox", { name: "Filter rows" });

  await table.getByRole("button", { name: "Maximize table" }).click();
  await filter.fill("stripe");
  await expect(table.locator("[data-table-count]")).toHaveText("2 of 4 rows");

  await filter.press("Escape");

  await expect(filter).toHaveValue("");
  await expect(table.locator("[data-table-count]")).toHaveText("4 rows");
  await expect(table).toHaveAttribute("data-figure-maximized", "");

  await filter.press("Escape");

  await expect(table).not.toHaveAttribute("data-figure-maximized");
  await expect(
    table.getByRole("button", { name: "Maximize table" }),
  ).toBeFocused();
});

test("should keep the filter header inside a 320px viewport", async ({
  page,
  dataTableViewerUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(dataTableViewerUrl);
  const table = page.locator("[data-data-table]").filter({
    hasText: "Queue depth by processor",
  });
  const header = table.locator(".data-table-header");
  const readOverflow = () =>
    header.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.max(
        0,
        element.scrollWidth - element.clientWidth,
        -rect.left,
        rect.right - innerWidth,
      );
    });

  await expect.poll(readOverflow).toBe(0);

  await table.getByRole("button", { name: "Maximize table" }).click();

  await expect.poll(readOverflow).toBe(0);
});

test("should ignore a drop without an internal column drag", async ({
  page,
  dataTableViewerUrl,
}) => {
  await page.goto(dataTableViewerUrl);
  const table = page.locator("[data-data-table]").filter({
    hasText: "Queue depth by processor",
  });
  const headers = table.locator(".data-table-head-label");
  const noteHeader = table.locator("th[data-table-column='3']");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await expect(headers).toHaveText([
    "Processor",
    "Attempts",
    "Last seen",
    "Note",
  ]);

  await noteHeader.dispatchEvent("drop", { dataTransfer });

  await expect(headers).toHaveText([
    "Processor",
    "Attempts",
    "Last seen",
    "Note",
  ]);
});
