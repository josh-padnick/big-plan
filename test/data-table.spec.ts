// Browser tests of DataTable interaction sequences whose outcome depends on
// state shared across sorting, grouping, filtering, and figure controls.

import { expect, test } from "./fixtures";

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

test("should consume filter Escape before restoring a maximized table", async ({
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
