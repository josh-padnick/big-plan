// Browser tests of the built-in components' inert content and responsive
// layouts. Render-health failures are enforced by fixtures.

import { expect, test } from "./fixtures";

test("should keep the schema index list out of the prose measure", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const list = page.locator(".table-schema-index-list").first();
  const geometry = await list.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    parentWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
    maxWidth: getComputedStyle(element).maxWidth,
  }));

  expect(geometry.width).toBeCloseTo(geometry.parentWidth);
  expect(geometry.maxWidth).toBe("none");
});

test("should left-align schema columns and separate rows", async ({
  page,
  tableSchemaViewerUrl,
}) => {
  await page.goto(tableSchemaViewerUrl);
  const grid = page.locator(".table-schema-grid").first();
  const alignment = await grid.locator("th, td").evaluateAll((cells) =>
    cells.map((cell) => ({
      textAlign: getComputedStyle(cell).textAlign,
      verticalAlign: getComputedStyle(cell).verticalAlign,
    })),
  );

  expect(alignment.length).toBeGreaterThan(5);
  expect(alignment.every(({ textAlign }) => textAlign === "left")).toBe(true);
  expect(alignment.every(({ verticalAlign }) => verticalAlign === "top")).toBe(
    true,
  );

  const headerRule = await grid
    .locator("thead th")
    .first()
    .evaluate((cell) => ({
      width: getComputedStyle(cell).borderBottomWidth,
      style: getComputedStyle(cell).borderBottomStyle,
    }));
  expect(headerRule).toEqual({ width: "1px", style: "solid" });

  const rowRule = await grid
    .locator("tbody tr")
    .nth(1)
    .locator("th, td")
    .first()
    .evaluate((cell) => ({
      width: getComputedStyle(cell).borderTopWidth,
      style: getComputedStyle(cell).borderTopStyle,
    }));
  expect(rowRule).toEqual({ width: "1px", style: "solid" });
});

test("should distinguish every callout type when the component plan renders", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  const calloutTypes = ["note", "tip", "warning", "danger"];
  for (const type of calloutTypes) {
    await expect(page.locator(`[data-callout="${type}"]`)).toBeVisible();
  }
  const accents = await page
    .locator("[data-callout]")
    .evaluateAll((callouts) =>
      callouts.map((callout) => getComputedStyle(callout).borderLeftColor),
    );
  expect(new Set(accents).size).toBe(calloutTypes.length);
});

test("should preserve component content without controls when JavaScript is disabled", async ({
  browser,
  componentsViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(componentsViewerUrl);

  await expect(page.locator("[data-callout]")).toHaveCount(4);
  await expect(page.locator("[data-callout]").first()).toBeVisible();
  const diffs = page.locator("[data-code-diff]");
  await expect(diffs).toHaveCount(2);
  await expect(
    diffs.first().locator('[data-diff-content="unified"]'),
  ).toBeVisible();
  await expect(
    diffs.first().locator('[data-diff-content="split"]'),
  ).toBeHidden();
  const annotation = diffs
    .first()
    .locator('[data-diff-content="unified"]')
    .getByRole("note", { name: "Lines 34-36" });
  await expect(annotation).toBeVisible();
  await expect(annotation).toContainText(
    "I added this counter with the catalog_cache prefix",
  );
  await expect(annotation).toContainText(
    "I added a dashboard query that isolates synchronous origin fallbacks.",
  );
  await expect(
    annotation.locator(".code-diff-annotation-body-clamped"),
  ).toHaveCount(0);
  await expect(page.locator(".code-diff-annotation-toggle")).toHaveCount(0);

  const tree = page.locator("[data-file-tree-diff]").first();
  await expect(tree.locator('[data-tree-content="combined"]')).toBeVisible();
  await expect(tree.locator('[data-tree-content="before-after"]')).toBeHidden();

  const schema = page.locator("[data-database-table-schema]");
  await expect(schema.locator(".table-schema-name-table")).toHaveText(
    "refresh_jobs",
  );
  await expect(schema.locator('[data-schema-badge="pk"]')).toBeVisible();
  const schemaHead = schema.locator("[data-schema-grid-column]").first();
  await expect(schemaHead).toHaveJSProperty("draggable", false);
  await expect(schemaHead.locator("svg[hidden]")).toBeHidden();
  const indexMarkers = schema.locator("[data-schema-indx]");
  expect(await indexMarkers.count()).toBeGreaterThan(0);
  await expect(schema.locator("button[data-schema-indx]")).toHaveCount(0);
  expect(await indexMarkers.first().evaluate((marker) => marker.tagName)).toBe(
    "SPAN",
  );

  const controls = page.locator(
    "[data-diff-toggle-group], [data-tree-toggle-group], [data-diff-menu-button], [data-schema-menu-button], [data-code-diff] [data-figure-maximize], [data-database-table-schema] [data-figure-maximize]",
  );
  await expect(controls).toHaveCount(9);
  for (const control of await controls.all()) {
    await expect(control).toBeHidden();
  }

  await context.close();
});

test("should stack the labeled DDL bands when JavaScript is disabled", async ({
  browser,
  tableSchemaViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(tableSchemaViewerUrl);
  const schema = page.locator("[data-database-table-schema]").first();
  await expect(schema.getByRole("tablist")).toHaveCount(0);
  await expect(schema.locator('[data-schema-section="indexes"]')).toBeVisible();
  const ddlPanels = schema.locator('[data-schema-section="ddl"]');
  await expect(ddlPanels).toHaveCount(2);
  await expect(ddlPanels.first()).toBeVisible();
  await expect(
    ddlPanels.first().locator(".table-schema-section-label"),
  ).toHaveText(/^Row security\s*DDL$/);
  await expect(
    ddlPanels.first().locator('[data-schema-badge="ddl"]'),
  ).toBeVisible();
  await expect(ddlPanels.first()).toContainText("ENABLE ROW LEVEL SECURITY");
  await expect(ddlPanels.last()).toBeVisible();
  await expect(ddlPanels.last()).toContainText("CREATE TRIGGER");
  await context.close();
});
