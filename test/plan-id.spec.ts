// Browser regression for persistence identity: same-title plans stay isolated,
// and an unstamped page remains interactive without touching browser storage.

import { expect, test } from "./fixtures";

test("should scope persisted viewer state to the stamped plan identity", async ({
  page,
  planIdCollisionViewerUrls,
}) => {
  await page.goto(planIdCollisionViewerUrls.first);
  await page.evaluate(() => localStorage.clear());
  const firstRoot = page.locator("html");
  const firstPlanId = await firstRoot.getAttribute("data-plan-id");
  const firstSlide = page.locator(
    '[data-collapsible="slide"][data-collapse-id="shared-section"]',
  );
  const firstTable = page.locator(
    '[data-database-table-schema][data-schema-table-name="shared.review_items"]',
  );
  const firstDataTable = page.locator("[data-data-table]").filter({
    hasText: "Shared review items",
  });
  const dataTableId = await firstDataTable.getAttribute("data-table-id");

  expect(firstPlanId).toMatch(/^[a-f0-9]{32}$/);
  expect(dataTableId).not.toBeNull();
  await firstTable.getByRole("button", { name: "Choose columns" }).click();
  await firstTable
    .getByRole("menuitemcheckbox", { name: "Comment" })
    .click();
  await expect(firstTable.locator(".table-schema-head-comment")).toBeHidden();
  await firstDataTable.getByRole("button", { name: "Choose columns" }).click();
  await firstDataTable
    .getByRole("menuitemcheckbox", { name: "Note" })
    .click();
  await expect(
    firstDataTable.locator('th[data-table-column="2"]'),
  ).toBeHidden();
  await page.getByRole("button", { name: "Add review comment" }).click();
  await page.getByRole("textbox", { name: "Comment draft" }).fill(
    "First plan draft",
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).filter(
          (key) =>
            key.startsWith("big-plan:table:") ||
            key.startsWith("big-plan:draft:") ||
            key.startsWith("big-plan:datatable:"),
        ).sort(),
      ),
    )
    .toEqual(
      [
        `big-plan:table:${firstPlanId ?? ""}:shared.review_items`,
        `big-plan:draft:${firstPlanId ?? ""}:document`,
        `big-plan:datatable:${firstPlanId ?? ""}:${dataTableId ?? ""}`,
      ].sort(),
    );
  await firstSlide
    .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
    .click();
  await expect(firstSlide).toHaveAttribute("data-collapsed", "");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("big-plan:collapse:"),
        ),
      ),
    )
    .toEqual([`big-plan:collapse:${firstPlanId ?? ""}:shared-section`]);

  await page.goto(planIdCollisionViewerUrls.second);
  const secondPlanId = await page.locator("html").getAttribute("data-plan-id");
  const secondSlide = page.locator(
    '[data-collapsible="slide"][data-collapse-id="shared-section"]',
  );
  const secondTable = page.locator(
    '[data-database-table-schema][data-schema-table-name="shared.review_items"]',
  );
  const secondDataTable = page.locator("[data-data-table]").filter({
    hasText: "Shared review items",
  });
  expect(secondPlanId).toMatch(/^[a-f0-9]{32}$/);
  expect(secondPlanId).not.toBe(firstPlanId);
  await expect(secondDataTable).toHaveAttribute(
    "data-table-id",
    dataTableId ?? "",
  );
  await expect(secondSlide).not.toHaveAttribute("data-collapsed");
  await expect(secondTable.locator(".table-schema-head-comment")).toBeVisible();
  await expect(
    secondDataTable.locator('th[data-table-column="2"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add review comment" }).click();
  await expect(page.getByRole("textbox", { name: "Comment draft" })).toHaveValue(
    "",
  );

  await secondTable.getByRole("button", { name: "Choose columns" }).click();
  await secondTable
    .getByRole("menuitemcheckbox", { name: "Default" })
    .click();
  await expect(secondTable.locator(".table-schema-head-default")).toBeHidden();
  await secondDataTable.getByRole("button", { name: "Choose columns" }).click();
  await secondDataTable
    .getByRole("menuitemcheckbox", { name: "Owner" })
    .click();
  await expect(
    secondDataTable.locator('th[data-table-column="1"]'),
  ).toBeHidden();
  await page.getByRole("textbox", { name: "Comment draft" }).fill(
    "Second plan draft",
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  await secondSlide
    .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
    .click();
  await expect(secondSlide).toHaveAttribute("data-collapsed", "");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("big-plan:collapse:"))
          .sort(),
      ),
    )
    .toEqual(
      [
        `big-plan:collapse:${firstPlanId ?? ""}:shared-section`,
        `big-plan:collapse:${secondPlanId ?? ""}:shared-section`,
      ].sort(),
    );

  await page.goto(planIdCollisionViewerUrls.first);
  await expect(firstTable.locator(".table-schema-head-comment")).toHaveAttribute(
    "hidden",
    "",
  );
  await expect(
    firstTable.locator(".table-schema-head-default"),
  ).not.toHaveAttribute("hidden");
  await expect(
    firstDataTable.locator('th[data-table-column="2"]'),
  ).toHaveAttribute("hidden", "");
  await expect(
    firstDataTable.locator('th[data-table-column="1"]'),
  ).not.toHaveAttribute("hidden");
  await page.getByRole("button", { name: "Add review comment" }).click();
  await expect(page.getByRole("textbox", { name: "Comment draft" })).toHaveValue(
    "First plan draft",
  );
});

for (const identity of ["absent", "empty"] as const) {
  test(`should skip persistence when the plan identity is ${identity}`, async ({
    page,
    planIdCollisionViewerUrls,
  }) => {
    await page.goto(
      identity === "absent"
        ? planIdCollisionViewerUrls.unidentified
        : planIdCollisionViewerUrls.empty,
    );
    await page.evaluate(() => localStorage.clear());
    const slide = page.locator(
      '[data-collapsible="slide"][data-collapse-id="shared-section"]',
    );
    const table = page.locator(
      '[data-database-table-schema][data-schema-table-name="shared.review_items"]',
    );
    const dataTable = page.locator("[data-data-table]").filter({
      hasText: "Shared review items",
    });

    if (identity === "absent") {
      await expect(page.locator("html")).not.toHaveAttribute("data-plan-id");
    } else {
      await expect(page.locator("html")).toHaveAttribute("data-plan-id", "");
    }
    await table.getByRole("button", { name: "Choose columns" }).click();
    await table.getByRole("menuitemcheckbox", { name: "Comment" }).click();
    await expect(table.locator(".table-schema-head-comment")).toBeHidden();
    await dataTable.getByRole("button", { name: "Choose columns" }).click();
    await dataTable
      .getByRole("menuitemcheckbox", { name: "Note" })
      .click();
    await expect(dataTable.locator('th[data-table-column="2"]')).toBeHidden();
    await page.getByRole("button", { name: "Add review comment" }).click();
    await page
      .getByRole("textbox", { name: "Comment draft" })
      .fill("Memory-only draft");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByRole("textbox", { name: "Comment draft" }),
    ).toHaveValue("Memory-only draft");
    await slide
      .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
      .click();
    await expect(slide).toHaveAttribute("data-collapsed", "");
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);

    await page.reload();
    await expect(slide).not.toHaveAttribute("data-collapsed");
    await expect(table.locator(".table-schema-head-comment")).toBeVisible();
    await expect(
      dataTable.locator('th[data-table-column="2"]'),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add review comment" }).click();
    await expect(
      page.getByRole("textbox", { name: "Comment draft" }),
    ).toHaveValue("");
  });
}
