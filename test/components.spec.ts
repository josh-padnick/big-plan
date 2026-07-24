// Browser tests of the built-in components' reader interactions, responsive
// layouts, clipboard behavior, full-screen dialogs, and no-JavaScript fallbacks.
// Render-health failures are enforced by fixtures.

import { boxOf, expect, test } from "./fixtures";

const RAW_CODE_SNIPPET = [
  "export const refreshCatalog = async (key: string): Promise<void> => {",
  "  const current = await catalogOrigin.read(key);",
  "  await cache.put(key, current, { ttlSeconds: 300 });",
  '  metrics.increment("catalog_cache.refresh_success");',
  "};",
  "",
].join("\n");

const RAW_GIT_DIFF = [
  "diff --git a/src/catalog/read-through-cache.ts b/src/catalog/read-through-cache.ts",
  "index 23ad911..890ce42 100644",
  "--- a/src/catalog/read-through-cache.ts",
  "+++ b/src/catalog/read-through-cache.ts",
  "@@ -18,5 +18,8 @@ export const readCatalog = async (key: string) => {",
  "   const cached = await cache.get(key);",
  "-  if (cached !== null && cached.ageSeconds <= 60) {",
  "+  if (cached !== null && cached.ageSeconds <= 150) {",
  "+    if (cached.ageSeconds > 60) {",
  "+      await refreshQueue.enqueueOnce(key);",
  "+    }",
  "     return cached.value;",
  "   }",
  // The example's blank context line is whitespace-stripped on disk. Copy
  // reproduces the fence content as MDX normalizes it: LF line endings with
  // a trailing newline, not the authored bytes.
  "",
  "@@ -31,4 +34,5 @@ export const readCatalog = async (key: string) => {",
  "   const value = await catalogOrigin.read(key);",
  "   await cache.put(key, value, { ttlSeconds: 300 });",
  '+  metrics.increment("catalog_cache.origin_fallback");',
  "   return value;",
  " };",
  "",
].join("\n");

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

test("should review planned file changes in combined and before/after trees", async ({
  browser,
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const tree = page.locator("[data-file-tree-diff]");
  const combined = tree.locator('[data-tree-content="combined"]');
  const beforeAfter = tree.locator('[data-tree-content="before-after"]');
  const before = tree.locator('[data-tree-pane="before"]');
  const after = tree.locator('[data-tree-pane="after"]');

  await test.step("combined is the default complete tree", async () => {
    await expect(tree).toBeVisible();
    await expect(tree).toHaveAttribute("data-tree-view", "combined");
    await expect(combined).toBeVisible();
    await expect(beforeAfter).toBeHidden();
    await expect(
      tree.getByRole("button", { name: "Combined view" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(combined.locator(":scope > ul")).toHaveCount(1);
    const summary = tree.locator(".file-tree-diff-summary");
    await expect(summary).toContainText("+3");
    await expect(summary).toContainText("~2");
    await expect(summary).toContainText("-2");
    await expect(summary).toContainText("->2");
    await expect(
      combined
        .locator(
          ".file-tree-list > .file-tree-item > .file-tree-children > " +
            ".file-tree-item > .file-tree-children > .file-tree-item > .file-tree-row",
        )
        .filter({ hasText: "refresh-worker.ts" }),
    ).toHaveCount(1);
  });

  await test.step("every change kind tints its name and spells its status at the row edge", async () => {
    const badgedRows = combined.locator("[data-tree-badge]");
    await expect(badgedRows).toHaveCount(9);
    const labels: ReadonlyArray<readonly [string, string, string]> = [
      ["added", "Added", "file-plus-2"],
      ["modified", "Modified", "file-diff"],
      ["removed", "Deleted", "file-minus-2"],
      ["renamed", "Renamed", "file-symlink"],
    ];
    for (const [badge, label, statusIcon] of labels) {
      const row = combined
        .locator(`[data-tree-badge="${badge}"][data-tree-entry="file"]`)
        .first();
      await expect(row.locator(".file-tree-label")).toHaveText(label);
      await expect(
        row.locator(`:scope > svg[data-lucide="${statusIcon}"]`),
      ).toBeVisible();
      const style = await row.evaluate((element) => {
        const name = element.querySelector(".file-tree-name");
        const status = element.querySelector(".file-tree-label");
        if (
          !(name instanceof HTMLElement) ||
          !(status instanceof HTMLElement)
        ) {
          throw new Error("Missing row name or status");
        }
        return {
          name: getComputedStyle(name).color,
          status: getComputedStyle(status).color,
          decoration: getComputedStyle(name).textDecorationLine,
          nameRight: name.getBoundingClientRect().right,
          statusLeft: status.getBoundingClientRect().left,
        };
      });
      expect(style.status).toBe(style.name);
      expect(style.decoration === "line-through").toBe(badge === "removed");
      // The status reads inline right beside the name, not at the far edge.
      expect(style.statusLeft).toBeGreaterThan(style.nameRight);
      expect(style.statusLeft - style.nameRight).toBeLessThan(60);
    }
    const plainName = await combined
      .locator(
        '[data-tree-entry="file"]:not([data-tree-badge]) .file-tree-name',
      )
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    const addedName = await combined
      .locator('[data-tree-badge="added"] .file-tree-name')
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    expect(addedName).not.toBe(plainName);
    // Changed directories keep the folder glyph, tinted like their name.
    const removedDir = combined
      .locator('[data-tree-badge="removed"][data-tree-entry="directory"]')
      .first();
    await expect(
      removedDir.locator(':scope > svg[data-lucide="folder"]'),
    ).toBeVisible();
    await expect(removedDir.locator(".file-tree-label")).toHaveText("Deleted");
  });

  await test.step("comments tuck behind instant hover hints", async () => {
    const hint = combined
      .locator('[data-tree-badge="added"] .file-tree-note-hint')
      .first();
    await expect(
      hint.locator('svg[data-lucide="message-square"]'),
    ).toBeVisible();
    await expect(
      combined.getByText("- Deduplicate refresh jobs by cache key."),
    ).toHaveCount(0);
    await hint.hover();
    await expect(page.locator(".file-tree-note-tip")).toHaveText(
      "Deduplicate refresh jobs by cache key.",
    );
    await page.mouse.move(0, 0);
    await expect(page.locator(".file-tree-note-tip")).toHaveCount(0);
  });

  await test.step("file rows sit a slight outdent from their foldable siblings", async () => {
    const srcRow = combined
      .locator('.file-tree-row[data-tree-entry="directory"]')
      .filter({ hasText: "src/" })
      .first();
    const readmeRow = combined
      .locator('.file-tree-row[data-tree-entry="file"]')
      .filter({ hasText: "README.md" })
      .first();
    const folderIcon = await boxOf(srcRow.locator(":scope > svg").first());
    const fileIcon = await boxOf(readmeRow.locator(":scope > svg").first());
    // The spacer is 6px narrower than the chevron, a deliberate nudge that
    // keeps files from reading as over-indented while staying in column.
    expect(folderIcon.x - fileIcon.x).toBeCloseTo(6, 0);
  });

  await test.step("directories fold by click and by the header controls", async () => {
    const srcRow = combined
      .locator('.file-tree-row[data-tree-entry="directory"]')
      .filter({ hasText: "src/" })
      .first();
    const srcToggle = srcRow.locator("[data-tree-toggle]");
    const nestedFile = combined.getByText("refresh-worker.ts");
    await expect(srcToggle).toHaveAttribute("aria-expanded", "true");
    const srcSummary = srcRow.locator(".file-tree-dir-summary");
    await expect(srcSummary).toBeHidden();
    await srcRow.click();
    await expect(nestedFile).toBeHidden();
    await expect(srcToggle).toHaveAttribute("aria-expanded", "false");
    await expect(srcSummary).toBeVisible();
    await expect(srcSummary).toContainText("+3");
    await expect(srcSummary).toContainText("-2");
    await srcRow.click();
    await expect(nestedFile).toBeVisible();
    await expect(srcSummary).toBeHidden();
    const headerControls = tree.locator(".file-tree-diff-controls");
    await headerControls
      .getByRole("button", { name: "Collapse all folders" })
      .click();
    await expect(combined.getByText("catalog-origin.ts")).toBeHidden();
    await expect(combined.getByText("src/", { exact: true })).toBeVisible();
    await headerControls
      .getByRole("button", { name: "Expand all folders" })
      .click();
    await expect(combined.getByText("catalog-origin.ts")).toBeVisible();
  });

  await test.step("before and after show the matching state and rename", async () => {
    await tree.getByRole("button", { name: "Side-by-side view" }).click();
    await expect(tree).toHaveAttribute("data-tree-view", "before-after");
    await expect(combined).toBeHidden();
    await expect(beforeAfter).toBeVisible();
    await expect(before.locator(".file-tree-diff-pane-caption")).toContainText(
      "Current",
    );
    await expect(after.locator(".file-tree-diff-pane-caption")).toContainText(
      "Planned",
    );
    await expect(before).toContainText("legacy-cache-counter.ts");
    await expect(before).not.toContainText("refresh-queue.ts");
    await expect(after).toContainText("refresh-queue.ts");
    await expect(after).toContainText("legacy-cache-counter.ts");
    await expect(before).toContainText("catalog-worker.env");
    await expect(before).not.toContainText("catalog-cache-worker.env");
    await expect(after).toContainText("catalog-cache-worker.env");
    await expect(after).not.toContainText("catalog-worker.env");
    await expect(before).toContainText("ops/");
    await expect(before).not.toContainText("deploy/");
    await expect(before).not.toContainText("queue/");
    await expect(after).toContainText("deploy/");
    await expect(after).not.toContainText("ops/");
    await expect(after).toContainText("queue/");
    await expect(after).toContainText("metrics/");
  });

  await test.step("before is untouched; every marker reads on the after tree", async () => {
    await expect(before.locator("[data-tree-badge]")).toHaveCount(0);
    for (const badge of ["added", "modified", "removed", "renamed"]) {
      await expect(
        after.locator(`[data-tree-badge="${badge}"]`),
      ).not.toHaveCount(0);
    }
    const tombstone = after.locator('[data-tree-badge="removed"]').first();
    await expect(tombstone.locator(".file-tree-label")).toHaveText("Deleted");
    const decoration = await tombstone
      .locator(".file-tree-name")
      .evaluate((element) => getComputedStyle(element).textDecorationLine);
    expect(decoration).toBe("line-through");
  });

  await test.step("the After bar can swap the diff for the final state", async () => {
    const toggle = after.getByRole("switch", { name: "Show diff" });
    const plain = after.locator('[data-tree-after-variant="plain"]');
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toHaveAttribute("data-state", "checked");
    await expect(
      after.locator('[data-tree-after-variant="diff"]'),
    ).toBeVisible();
    await expect(plain).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(plain).toBeVisible();
    await expect(plain.locator("[data-tree-badge]")).toHaveCount(0);
    await expect(plain).not.toContainText("legacy-cache-counter.ts");
    await expect(plain).toContainText("refresh-queue.ts");
    await expect(plain).toContainText("deploy/");
    await expect(plain.locator(".file-tree-note-hint").first()).toBeVisible();
    await toggle.click();
    await expect(
      after.locator('[data-tree-after-variant="diff"]'),
    ).toBeVisible();
  });

  await test.step("each pane bar folds only its own pane", async () => {
    const afterDiff = after.locator('[data-tree-after-variant="diff"]');
    await before.getByRole("button", { name: "Collapse all folders" }).click();
    await expect(before.getByText("catalog-origin.ts")).toBeHidden();
    await expect(afterDiff.getByText("catalog-origin.ts")).toBeVisible();
    await before.getByRole("button", { name: "Expand all folders" }).click();
    await expect(before.getByText("catalog-origin.ts")).toBeVisible();
  });

  await test.step("the panes sit side by side on a wide viewport", async () => {
    const geometry = await beforeAfter.evaluate((view) => {
      const before = view.querySelector('[data-tree-pane="before"]');
      const after = view.querySelector('[data-tree-pane="after"]');
      if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) {
        throw new Error("Missing before/after panes");
      }
      return {
        beforeX: before.getBoundingClientRect().x,
        beforeY: before.getBoundingClientRect().y,
        afterX: after.getBoundingClientRect().x,
        afterY: after.getBoundingClientRect().y,
      };
    });
    expect(geometry.afterX).toBeGreaterThan(geometry.beforeX);
    expect(geometry.afterY).toBe(geometry.beforeY);
  });

  await test.step("the preference survives reload", async () => {
    await page.reload();
    await expect(tree).toHaveAttribute("data-tree-view", "before-after");
    await expect(
      tree.getByRole("button", { name: "Side-by-side view" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(beforeAfter).toBeVisible();
  });

  let expandScrollY = 0;

  await test.step("the tree expands full screen named by its title", async () => {
    const expand = tree.getByRole("button", {
      name: "View file tree full screen",
    });
    await expand.scrollIntoViewIfNeeded();
    expandScrollY = await page.evaluate(() => window.scrollY);
    expect(expandScrollY).toBeGreaterThan(0);
    await expand.click();

    const dialog = page.locator("dialog.component-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Planned changes");
    // The dialog hugs the tree instead of claiming the whole viewport.
    const size = await dialog.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      viewport: window.innerWidth,
    }));
    expect(size.width).toBeLessThan(size.viewport * 0.9);
    await expect(dialog.locator("[data-file-tree-diff]")).toHaveAttribute(
      "data-tree-expanded",
      "",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => getComputedStyle(document.documentElement).overflow,
        ),
      )
      .toBe("hidden");
  });

  await test.step("the view toggle keeps working inside the dialog", async () => {
    const dialog = page.locator("dialog.component-dialog");
    await dialog.getByRole("button", { name: "Combined view" }).click();
    await expect(
      dialog.locator('[data-tree-content="combined"]'),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Side-by-side view" }).click();
    await expect(
      dialog.locator('[data-tree-content="before-after"]'),
    ).toBeVisible();
  });

  await test.step("closing restores the tree and the scroll position", async () => {
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.component-dialog")).toHaveCount(0);
    await expect(tree).toBeVisible();
    await expect(tree).not.toHaveAttribute("data-tree-expanded", "");
    await expect(
      tree.getByRole("button", { name: "View file tree full screen" }),
    ).toBeVisible();
    await expect(beforeAfter).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(expandScrollY);
  });

  await test.step("the panes stack before above after on a narrow viewport", async () => {
    await page.setViewportSize({ width: 500, height: 800 });
    // Both rects are read in one evaluate so the narrow-layout reflow cannot
    // land between the two measurements and fake an overlap.
    const stacked = await beforeAfter.evaluate((view) => {
      const before = view.querySelector('[data-tree-pane="before"]');
      const after = view.querySelector('[data-tree-pane="after"]');
      if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) {
        throw new Error("Missing before/after panes");
      }
      const beforeRect = before.getBoundingClientRect();
      const afterRect = after.getBoundingClientRect();
      return {
        beforeBottom: beforeRect.y + beforeRect.height,
        afterY: afterRect.y,
        afterX: afterRect.x,
        beforeX: beforeRect.x,
      };
    });
    expect(stacked.afterX).toBe(stacked.beforeX);
    expect(stacked.afterY).toBeGreaterThanOrEqual(stacked.beforeBottom - 1);
  });

  await test.step("combined remains the complete no-JavaScript view", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(componentsViewerUrl);
    const staticTree = staticPage.locator("[data-file-tree-diff]");
    await expect(staticTree).toBeVisible();
    await expect(staticTree).toContainText("Planned changes");
    await expect(staticTree).toContainText(
      "catalog-worker.env -> catalog-cache-worker.env",
    );
    await expect(
      staticTree.locator('[data-tree-content="combined"]'),
    ).toBeVisible();
    await expect(
      staticTree.locator('[data-tree-content="before-after"]'),
    ).toBeHidden();
    await expect(staticTree.locator("[data-tree-toggle-group]")).toBeHidden();
    await expect(
      staticTree.locator("[data-tree-toggle-spacer]").first(),
    ).toBeHidden();
    await expect(
      staticTree
        .locator('[data-tree-content="combined"] [data-tree-badge="renamed"]')
        .first(),
    ).toBeVisible();
    await expect(
      staticTree
        .locator('[data-tree-content="combined"]')
        .locator(
          ".file-tree-list > .file-tree-item > .file-tree-children > " +
            ".file-tree-item > .file-tree-children > .file-tree-item > .file-tree-row",
        )
        .filter({ hasText: "refresh-worker.ts" }),
    ).toHaveCount(1);
    await context.close();
  });
});

test("should present a plain file hierarchy without change styling", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const tree = page.locator("[data-file-tree]:not([data-file-tree-diff])");

  await test.step("the plain tree folds too", async () => {
    const dirRow = tree
      .locator('.file-tree-row[data-tree-entry="directory"]')
      .first();
    const child = tree.getByText("worker-config.ts");
    await tree.getByRole("button", { name: "Collapse all folders" }).click();
    await expect(child).toBeHidden();
    await dirRow.click();
    await expect(child).toBeVisible();
  });

  await test.step("the worker layout keeps hierarchy and notes", async () => {
    await expect(tree).toBeVisible();
    await expect(tree).toContainText("Worker pool layout");
    await expect(tree).toContainText(
      "Consumes deduplicated catalog refresh jobs.",
    );
    await expect(
      tree.locator(".file-tree-children .file-tree-row"),
    ).toHaveCount(2);
  });

  await test.step("every row uses plain file or folder presentation", async () => {
    await expect(tree.locator("[data-tree-badge]")).toHaveCount(0);
    await expect(tree.locator(".file-tree-label")).toHaveCount(0);
    await expect(tree.locator('svg[data-lucide="folder"]')).toHaveCount(1);
    await expect(tree.locator('svg[data-lucide="file"]')).toHaveCount(2);
  });
});

test("should review an annotated file-absolute code snippet", async ({
  browser,
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const snippet = page.locator("[data-code-snippet]").filter({
    hasText: "src/catalog/refresh-worker.ts",
  });
  const annotation = snippet.locator('[data-snippet-annotation="44-45"]');

  await test.step("the gutter starts at the file line", async () => {
    await expect(snippet.locator("[data-snippet-line-number]")).toHaveText([
      "42",
      "43",
      "44",
      "45",
      "46",
    ]);
  });

  await test.step("the annotation follows its anchor", async () => {
    await expect(annotation).toContainText("Lines 44-45");
    const positions = await snippet.evaluate((figure) => {
      const row = figure.querySelector('[data-snippet-line="45"]');
      const card = figure.querySelector('[data-snippet-annotation="44-45"]');
      if (!(row instanceof HTMLElement) || !(card instanceof HTMLElement)) {
        throw new Error("Missing annotation anchor geometry");
      }
      return {
        adjacent: row.nextElementSibling === card,
        rowBottom: row.getBoundingClientRect().bottom,
        cardTop: card.getBoundingClientRect().top,
      };
    });
    expect(positions.adjacent).toBe(true);
    expect(positions.cardTop).toBeGreaterThanOrEqual(positions.rowBottom);
  });

  await test.step("the annotated lines carry the accent", async () => {
    const colors = await snippet.evaluate((figure) => {
      const plain = figure.querySelector('[data-snippet-line="42"]');
      const marked = figure.querySelector('[data-snippet-line="44"]');
      const gutter = marked?.querySelector(".code-snippet-line-number");
      if (!(plain instanceof HTMLElement) || !(marked instanceof HTMLElement)) {
        throw new Error("Missing snippet rows");
      }
      return {
        plain: getComputedStyle(plain).backgroundColor,
        marked: getComputedStyle(marked).backgroundColor,
        marker:
          gutter instanceof HTMLElement
            ? getComputedStyle(gutter, "::before").backgroundColor
            : "",
      };
    });
    expect(colors.marked).not.toBe(colors.plain);
    expect(colors.marker).not.toBe("");
    await expect(snippet.locator("[data-snippet-annotated]")).toHaveCount(3);
  });

  await test.step("hovering links the annotation with its lines", async () => {
    const row = snippet.locator('[data-snippet-line="44"]');
    const rowRest = await row.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await annotation.hover();
    const rowLinked = await row.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(rowLinked).not.toBe(rowRest);
    await page.mouse.move(0, 0);
    const cardRest = await annotation.evaluate((element) => ({
      border: getComputedStyle(element).borderTopColor,
      background: getComputedStyle(element).backgroundColor,
    }));
    await row.hover();
    const cardLinked = await annotation.evaluate((element) => ({
      border: getComputedStyle(element).borderTopColor,
      background: getComputedStyle(element).backgroundColor,
    }));
    expect(cardLinked.border).not.toBe(cardRest.border);
    expect(cardLinked.background).not.toBe(cardRest.background);
    await page.mouse.move(0, 0);
  });

  await test.step("copy code excludes review chrome", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) => {
            document.body.dataset.copiedSnippet = value;
            return Promise.resolve();
          },
        },
      });
    });
    await snippet.getByRole("button", { name: "More actions" }).click();
    await snippet.getByRole("menuitem", { name: "Copy code" }).click();
    expect(await page.locator("body").getAttribute("data-copied-snippet")).toBe(
      RAW_CODE_SNIPPET,
    );
    await expect(
      snippet.getByRole("button", { name: "Code copied!" }),
    ).toBeVisible();
  });

  await test.step("the static block survives without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(componentsViewerUrl);
    const staticSnippet = staticPage.locator("[data-code-snippet]");
    await expect(staticSnippet).toBeVisible();
    await expect(
      staticSnippet.locator('[data-snippet-line="42"]'),
    ).toContainText("export const refreshCatalog");
    await expect(
      staticSnippet.locator('[data-snippet-annotation="44-45"]'),
    ).toContainText("cache write must complete");
    await expect(
      staticSnippet.locator("[data-snippet-menu-button]"),
    ).toBeHidden();
    await context.close();
  });
});

test("should remember the selected diff view when the page reloads", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const unified = diff.locator('[data-diff-content="unified"]');
  const split = diff.locator('[data-diff-content="split"]');
  const unifiedButton = diff.getByRole("button", { name: "Unified view" });
  const splitButton = diff.getByRole("button", { name: "Side-by-side view" });
  await expect(unified).toBeVisible();
  await expect(split).toBeHidden();
  await expect(unifiedButton).toHaveAttribute("aria-pressed", "true");
  await expect(splitButton).toHaveAttribute("aria-pressed", "false");

  await splitButton.click();

  await expect(diff).toHaveAttribute("data-diff-view", "split");
  await expect(unified).toBeHidden();
  await expect(split).toBeVisible();
  await expect(splitButton).toHaveAttribute("aria-pressed", "true");
  await expect(unifiedButton).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(diff).toHaveAttribute("data-diff-view", "split");
  await expect(
    diff.getByRole("button", { name: "Side-by-side view" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("should keep a range Annotation visible when switching diff views", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const unified = diff.locator('[data-diff-content="unified"]');
  const split = diff.locator('[data-diff-content="split"]');
  const annotationText = "I added this counter with the catalog_cache prefix";
  const unifiedAnnotation = unified.getByRole("note", { name: "Lines 34-36" });
  const splitAnnotation = split.getByRole("note", { name: "Lines 34-36" });
  const shortAnnotation = unified.getByRole("note", { name: "Line 19" });

  await test.step("long content clamps while short content stays complete", async () => {
    await expect(unifiedAnnotation).toBeVisible();
    await expect(unifiedAnnotation).toContainText(annotationText);
    const body = unifiedAnnotation.locator(".annotation-card-body");
    const toggle = unifiedAnnotation.locator(".code-diff-annotation-toggle");
    await expect(toggle).toHaveAccessibleName("View more…");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const bodyId = await body.getAttribute("id");
    expect(bodyId).not.toBeNull();
    await expect(toggle).toHaveAttribute("aria-controls", bodyId ?? "");
    expect(
      await body.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName("View less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      await body.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeLessThanOrEqual(1);
    const originalBody = await body.innerHTML();
    await body.evaluate((element) => {
      element.textContent = "Temporarily short.";
    });
    await expect(toggle).toHaveCount(0);
    await body.evaluate((element, content) => {
      element.innerHTML = content;
    }, originalBody);
    await expect(toggle).toHaveAccessibleName("View less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      await body.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    ).toBeLessThanOrEqual(1);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName("View more…");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(shortAnnotation.getByRole("button")).toHaveCount(0);
  });

  await test.step("the annotation follows the selected view and side", async () => {
    await expect(splitAnnotation).toBeHidden();

    await diff.getByRole("button", { name: "Side-by-side view" }).click();

    await expect(unifiedAnnotation).toBeHidden();
    await expect(splitAnnotation).toBeVisible();
    await expect(splitAnnotation).toContainText(annotationText);
    expect(
      await splitAnnotation.evaluate(
        (annotation) =>
          annotation.closest<HTMLElement>("[data-diff-pane]")?.dataset.diffPane,
      ),
    ).toBe("new");
    const oldAnnotation = split.getByRole("note", { name: "Line 19" });
    expect(
      await oldAnnotation.evaluate(
        (annotation) =>
          annotation.closest<HTMLElement>("[data-diff-pane]")?.dataset.diffPane,
      ),
    ).toBe("old");
    await expect(
      split
        .locator('[data-diff-pane="old"]')
        .getByRole("note", { name: "Lines 34-36" }),
    ).toHaveCount(0);
    await expect(
      split
        .locator('[data-diff-pane="new"]')
        .getByRole("note", { name: "Line 19" }),
    ).toHaveCount(0);
  });

  await test.step("each split hunk owns one header and two pane scrollers", async () => {
    const scrollContexts = await split
      .locator(".code-diff-split-hunk")
      .evaluateAll((hunks) =>
        hunks.map((hunk) =>
          [...hunk.querySelectorAll<HTMLElement>("*")]
            .filter((element) => {
              const overflow = getComputedStyle(element).overflowX;
              return overflow === "auto" || overflow === "scroll";
            })
            .map((element) => ({
              header: element.classList.contains(
                "code-diff-split-header-scroll",
              ),
              pane: element.dataset.diffPane ?? null,
            })),
        ),
      );
    expect(scrollContexts).toHaveLength(2);
    for (const hunkContexts of scrollContexts) {
      expect(hunkContexts).toHaveLength(3);
      expect(hunkContexts.filter((context) => context.header)).toHaveLength(1);
      expect(
        hunkContexts
          .map((context) => context.pane)
          .filter(Boolean)
          .sort(),
      ).toEqual(["new", "old"]);
    }
  });

  await test.step("the opposite spacer tracks annotation height changes", async () => {
    const heights = async () =>
      splitAnnotation.evaluate((annotation) => {
        const card = annotation.closest<HTMLElement>("[data-annotation-card]");
        const component = annotation.closest<HTMLElement>("[data-code-diff]");
        const id = card?.dataset.annotationCard;
        const spacer = [
          ...(component?.querySelectorAll<HTMLElement>(
            "[data-annotation-spacer]",
          ) ?? []),
        ].find((candidate) => candidate.dataset.annotationSpacer === id);
        if (card === null || card === undefined || spacer === undefined) {
          throw new Error("Missing split annotation card or spacer");
        }
        return {
          card: card.getBoundingClientRect().height,
          spacer: spacer.getBoundingClientRect().height,
        };
      });
    await expect.poll(heights).toEqual(
      expect.objectContaining({
        card: expect.any(Number),
        spacer: expect.any(Number),
      }),
    );
    await expect
      .poll(async () => {
        const measured = await heights();
        return Math.abs(measured.card - measured.spacer);
      })
      .toBeLessThan(1);

    const toggle = splitAnnotation.locator(".code-diff-annotation-toggle");
    await toggle.click();
    await expect
      .poll(async () => {
        const measured = await heights();
        return Math.abs(measured.card - measured.spacer);
      })
      .toBeLessThan(1);
    await toggle.click();
  });

  await test.step("a long old line cannot push the new card offscreen at scroll zero", async () => {
    const layout = await splitAnnotation.evaluate((annotation) => {
      const surround = annotation.closest<HTMLElement>(
        "[data-annotation-card]",
      );
      const hunk = annotation.closest<HTMLElement>(".code-diff-split-hunk");
      const oldPane = hunk?.querySelector<HTMLElement>(
        '[data-diff-pane="old"]',
      );
      const newPane = hunk?.querySelector<HTMLElement>(
        '[data-diff-pane="new"]',
      );
      const oldLine = oldPane?.querySelector<HTMLElement>(
        ".code-diff-line-content",
      );
      if (
        surround === null ||
        hunk === null ||
        oldPane === null ||
        newPane === null ||
        oldLine === null
      ) {
        throw new Error("Missing split annotation regression fixture");
      }
      const originalLine = oldLine.textContent;
      oldLine.textContent = `extremely-long-old-side-${"x".repeat(10_000)}`;
      oldPane.scrollLeft = 0;
      newPane.scrollLeft = 0;
      const annotationBox = annotation.getBoundingClientRect();
      const surroundBox = surround.getBoundingClientRect();
      const oldPaneBox = oldPane.getBoundingClientRect();
      const newPaneBox = newPane.getBoundingClientRect();
      const result = {
        annotationLeft: annotationBox.left,
        annotationRight: annotationBox.right,
        surroundLeft: surroundBox.left,
        surroundRight: surroundBox.right,
        viewportWidth: window.innerWidth,
        oldPaneWidth: oldPaneBox.width,
        newPaneWidth: newPaneBox.width,
        oldScrollLeft: oldPane.scrollLeft,
        newScrollLeft: newPane.scrollLeft,
        oldScrollWidth: oldPane.scrollWidth,
      };
      oldLine.textContent = originalLine;
      return result;
    });
    expect(layout.oldScrollWidth).toBeGreaterThan(layout.viewportWidth * 10);
    expect(layout.oldScrollLeft).toBe(0);
    expect(layout.newScrollLeft).toBe(0);
    expect(Math.abs(layout.oldPaneWidth - layout.newPaneWidth)).toBeLessThan(2);
    expect(layout.annotationLeft).toBeGreaterThanOrEqual(0);
    expect(layout.annotationRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.surroundLeft).toBeGreaterThanOrEqual(0);
    expect(layout.surroundRight).toBeLessThanOrEqual(layout.viewportWidth);
  });

  await test.step("the annotation stays pinned to the visible new pane in both themes", async () => {
    for (const theme of ["light", "dark"] as const) {
      const layout = await splitAnnotation.evaluate(
        (annotation, selectedTheme) => {
          document.documentElement.dataset.theme = selectedTheme;
          const surround = annotation.closest<HTMLElement>(
            "[data-annotation-card]",
          );
          const scroller = annotation.closest<HTMLElement>("[data-diff-pane]");
          if (surround === null || scroller === null) {
            throw new Error(
              "Missing split annotation surround or pane scroller",
            );
          }
          scroller.scrollLeft = scroller.scrollWidth;
          const surroundBox = surround.getBoundingClientRect();
          const scrollerBox = scroller.getBoundingClientRect();
          const cardStyle = getComputedStyle(annotation);
          const surroundStyle = getComputedStyle(surround);
          return {
            surroundLeft: surroundBox.left,
            surroundRight: surroundBox.right,
            cardBackground: cardStyle.backgroundColor,
            cardColor: cardStyle.color,
            surroundBackground: surroundStyle.backgroundColor,
            surroundBorder: surroundStyle.borderLeftColor,
            scrollerLeft: scrollerBox.left,
            scrollerRight: scrollerBox.right,
            scrollLeft: scroller.scrollLeft,
          };
        },
        theme,
      );
      expect(layout.scrollLeft).toBeGreaterThan(0);
      expect(
        Math.abs(layout.surroundLeft - layout.scrollerLeft),
        JSON.stringify(layout),
      ).toBeLessThan(2);
      expect(layout.surroundRight).toBeLessThanOrEqual(
        layout.scrollerRight + 1,
      );
      expect(layout.cardColor).not.toBe(layout.cardBackground);
      expect(layout.surroundBackground).not.toBe(layout.cardBackground);
      expect(layout.surroundBorder).not.toBe(layout.surroundBackground);
    }
  });

  await test.step("the disclosure still works in full screen", async () => {
    await diff.getByRole("button", { name: "View diff full screen" }).click();
    const dialog = page.locator("dialog.component-dialog");
    const dialogAnnotation = dialog.getByRole("note", { name: "Lines 34-36" });
    const toggle = dialogAnnotation.locator(".code-diff-annotation-toggle");
    await expect(toggle).toHaveAccessibleName("View more…");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAccessibleName("View less");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test("should fallback-copy Annotation code within a full-screen diff", async ({
  annotationCodeViewerUrl,
  page,
}) => {
  await page.goto(annotationCodeViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = () => {
      const textarea = document.querySelector(
        "textarea:not([data-diff-source]):not([data-snippet-source]):not([data-schema-source])",
      );
      document.body.dataset.fallbackCopy =
        textarea instanceof HTMLTextAreaElement
          ? `${textarea.closest("dialog") === null ? "outside" : "dialog"}:${textarea.value}`
          : "missing";
      return textarea instanceof HTMLTextAreaElement;
    };
  });

  const diff = page.locator("[data-code-diff]");
  await diff.getByRole("button", { name: "View diff full screen" }).click();
  const copy = page.locator(
    'dialog [data-diff-content="unified"] [data-code-block] [data-copy-code]',
  );
  await copy.click();

  expect(await page.locator("body").getAttribute("data-fallback-copy")).toBe(
    "dialog:retry();\n",
  );
  await expect(copy).toHaveAccessibleName("Code copied");
});

test("should contain CodeDiff overflow without clipping the page", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(componentsViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  await diff.getByRole("button", { name: "Side-by-side view" }).click();
  const overflow = await page.evaluate(() => ({
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.bodyOverflowX).toBe("visible");
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBe(
    overflow.clientWidth,
  );
  expect(
    await diff
      .locator("[data-diff-pane]")
      .evaluateAll((panes) =>
        panes.some((pane) => pane.scrollWidth > pane.clientWidth),
      ),
  ).toBe(true);
});

test("should expand a diff to full screen and restore it when dismissed", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const expand = diff.getByRole("button", { name: "View diff full screen" });
  await expand.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
  await expand.click();

  const dialog = page.locator("dialog.component-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(
    "src/catalog/read-through-cache.ts",
  );
  await expect(dialog.locator("[data-code-diff]")).toHaveAttribute(
    "data-diff-expanded",
    "",
  );
  await expect(
    dialog.getByRole("button", { name: "Exit full screen" }),
  ).toBeVisible();

  // The modal centers in the viewport and locks the page behind it.
  const horizontalGaps = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: window.innerWidth - box.right };
  });
  expect(horizontalGaps.left).toBeGreaterThan(0);
  expect(Math.abs(horizontalGaps.left - horizontalGaps.right)).toBeLessThan(2);
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).overflow),
    )
    .toBe("hidden");

  await page.keyboard.press("Escape");

  await expect(page.locator("dialog.component-dialog")).toHaveCount(0);
  await expect(diff).toBeVisible();
  await expect(diff).not.toHaveAttribute("data-diff-expanded", "");
  await expect(
    diff.getByRole("button", { name: "View diff full screen" }),
  ).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
});

test("should copy the raw diff and the file path from the actions menu", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          document.body.dataset.copiedDiff = value;
          return Promise.resolve();
        },
      },
    });
  });

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const menuButton = diff.locator("[data-diff-menu-button]");
  const menu = diff.getByRole("menu", { name: "Diff actions" });

  await expect(menuButton).toHaveAccessibleName("More actions");
  await menuButton.click();
  await expect(menu).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await menu.getByRole("menuitem", { name: "Copy diff" }).click();

  expect(await page.locator("body").getAttribute("data-copied-diff")).toBe(
    RAW_GIT_DIFF,
  );
  await expect(menu).toBeHidden();
  await expect(menuButton).toHaveAccessibleName("Diff copied!");

  await menuButton.click();
  await menu.getByRole("menuitem", { name: "Copy path" }).click();
  expect(await page.locator("body").getAttribute("data-copied-diff")).toBe(
    "src/catalog/read-through-cache.ts",
  );
  await expect(menuButton).toHaveAccessibleName("Path copied!");
});

test("should fallback-copy within a full-screen diff", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = () => {
      const textareas = document.querySelectorAll(
        "textarea:not([data-diff-source]):not([data-snippet-source]):not([data-schema-source])",
      );
      const textarea = textareas.item(textareas.length - 1);
      document.body.dataset.fallbackCopy =
        textarea instanceof HTMLTextAreaElement
          ? `${textarea.closest("dialog") === null ? "outside" : "dialog"}:${textarea.value}`
          : "missing";
      return textarea instanceof HTMLTextAreaElement;
    };
  });

  const diff = page.locator("[data-code-diff]").first();
  await diff.getByRole("button", { name: "View diff full screen" }).click();
  const expandedDiff = page.locator("dialog [data-code-diff]");
  const menuButton = expandedDiff.locator("[data-diff-menu-button]");
  await expect(page.locator("dialog.component-dialog[open]")).toHaveCount(1);
  await expect(
    page.locator(
      "textarea:not([data-diff-source]):not([data-snippet-source]):not([data-schema-source])",
    ),
  ).toHaveCount(0);
  await menuButton.evaluate((button) => button.click());
  await expandedDiff
    .getByRole("menuitem", { name: "Copy path" })
    .evaluate((button) => button.click());

  expect(await page.locator("body").getAttribute("data-fallback-copy")).toBe(
    "dialog:src/catalog/read-through-cache.ts",
  );
  await expect(menuButton).toBeFocused();
  await expect(menuButton).toHaveAccessibleName("Path copied!");
});

test("should support keyboard navigation in the diff actions menu", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  const diff = page.locator("[data-code-diff]").filter({
    hasText: "src/catalog/read-through-cache.ts",
  });
  const menuButton = diff.locator("[data-diff-menu-button]");
  const copyPath = diff.getByRole("menuitem", { name: "Copy path" });
  const copyDiff = diff.getByRole("menuitem", { name: "Copy diff" });

  await menuButton.focus();
  await menuButton.press("ArrowDown");
  await expect(copyPath).toBeFocused();
  await copyPath.press("ArrowUp");
  await expect(copyDiff).toBeFocused();
  await copyDiff.press("Home");
  await expect(copyPath).toBeFocused();
  await copyPath.press("End");
  await expect(copyDiff).toBeFocused();
  await copyDiff.press("Escape");
  await expect(menuButton).toBeFocused();
  await expect(diff.getByRole("menu", { name: "Diff actions" })).toBeHidden();

  await menuButton.press("ArrowUp");
  await expect(copyDiff).toBeFocused();
  await copyDiff.press("Tab");
  await expect(diff.getByRole("menu", { name: "Diff actions" })).toBeHidden();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(
    diff.getByRole("button", { name: "View diff full screen" }),
  ).toBeFocused();

  await menuButton.focus();
  await menuButton.press("ArrowDown");
  await expect(copyPath).toHaveAttribute("tabindex", "0");
  await expect(copyDiff).toHaveAttribute("tabindex", "-1");
  await copyPath.press("Shift+Tab");
  await expect(diff.getByRole("menu", { name: "Diff actions" })).toBeHidden();
  await expect(menuButton).toBeFocused();
});

test("should let a short diff actions menu escape the figure", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  const diff = page.locator("[data-code-diff]").last();
  await diff.locator(".code-diff-view").evaluateAll((views) => {
    for (const view of views) {
      view.replaceChildren();
    }
  });
  await diff.getByRole("button", { name: "More actions" }).click();

  const copyDiff = diff.getByRole("menuitem", { name: "Copy diff" });
  await expect(copyDiff).toBeVisible();
  const bounds = await diff.evaluate((figure) => {
    const item = figure.querySelector<HTMLElement>("[data-diff-copy]");
    if (item === null) {
      throw new Error("Missing Copy diff menu item");
    }
    return {
      figureBottom: figure.getBoundingClientRect().bottom,
      itemBottom: item.getBoundingClientRect().bottom,
      figureOverflow: getComputedStyle(figure).overflow,
    };
  });
  expect(bounds.itemBottom).toBeGreaterThan(bounds.figureBottom);
  expect(bounds.figureOverflow).toBe("visible");
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
  const schema = page.locator("[data-database-table-schema]");
  await expect(schema.locator(".table-schema-name-table")).toHaveText(
    "refresh_jobs",
  );
  await expect(schema.locator('[data-schema-badge="pk"]')).toBeVisible();
  const controls = page.locator(
    "[data-diff-toggle-group], [data-diff-menu-button], [data-diff-expand], [data-schema-menu-button], [data-schema-expand]",
  );
  await expect(controls).toHaveCount(8);
  for (const control of await controls.all()) {
    await expect(control).toBeHidden();
  }

  await context.close();
});

const RAW_TABLE_SCHEMA = [
  "id           bigint      [pk, increment]",
  "cache_key    text        [not null, note: 'The catalog cache key this job refreshes.']",
  "requested_by bigint      [ref: > catalog.api_instances.id, delete: set null]",
  "attempts     integer     [not null, default: 0, check: 'attempts <= 5']",
  "status       text        [not null, default: 'queued', note: 'Allowed: queued | running | done | failed.']",
  "enqueued_at  timestamptz [not null, default: `now()`]",
  "",
  "indexes {",
  "  cache_key [unique, name: 'refresh_jobs_live_key_idx', where: 'status <> \\'done\\'', note: 'Ensures one unfinished job per cache key.']",
  "  (status, enqueued_at) [name: 'refresh_jobs_scan_idx']",
  "}",
  "",
  "Note: 'One row per queued catalog refresh.'",
  "",
].join("\n");

test("should review a database table schema end to end", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const schema = page.locator("[data-database-table-schema]");
  const menuButton = schema.locator("[data-schema-menu-button]");
  const menu = schema.getByRole("menu", { name: "Table schema actions" });

  await test.step("the header names the schema-qualified table", async () => {
    await expect(schema.locator(".table-schema-name-schema")).toHaveText(
      "catalog.",
    );
    await expect(schema.locator(".table-schema-name-table")).toHaveText(
      "refresh_jobs",
    );
    await expect(schema.locator("[data-schema-table-note]")).toHaveText(
      "One row per queued catalog refresh.",
    );
  });

  await test.step("the grid answers columns, types, and rules in one row each", async () => {
    await expect(
      schema.locator(".table-schema-scroll").first().locator("thead th"),
    ).toHaveText(["Column", "Type", "Constraints", "Default", "Comment"]);
    await expect(
      schema.locator('[data-schema-column="cache_key"] [data-schema-note]'),
    ).toHaveText("The catalog cache key this job refreshes.");
    await expect(
      schema.locator(
        '[data-schema-column="cache_key"] [data-schema-badge="idx"]',
      ),
    ).toHaveText("INDX 1");
    const statusRow = schema.locator('[data-schema-column="status"]');
    await expect(statusRow.locator('[data-schema-badge="idx"]')).toHaveText(
      "INDX 2",
    );
    await expect(statusRow).toContainText("WHERE INDX 1");
    await expect(schema.locator("[data-schema-column]")).toHaveCount(6);
    const idRow = schema.locator('[data-schema-column="id"]');
    await expect(idRow.locator('[data-schema-badge="pk"]')).toHaveText("PK");
    await expect(idRow.locator('[data-schema-badge="identity"]')).toHaveText(
      "Identity",
    );
    await expect(idRow).toContainText("not null");
    await expect(schema.locator('[data-schema-column="status"]')).toContainText(
      "'queued'",
    );
  });

  await test.step("the foreign key and check live inside their columns' rows", async () => {
    const fkRow = schema.locator('[data-schema-column="requested_by"]');
    await expect(fkRow).toContainText("nullable");
    const refLine = fkRow.locator("[data-schema-ref]");
    await expect(refLine).toContainText("catalog.api_instances.id");
    await expect(refLine).toContainText("ON DELETE SET NULL");
    await expect(
      schema.locator('[data-schema-column="attempts"] [data-schema-check]'),
    ).toHaveText("CHECK (attempts <= 5)");
  });

  await test.step("the numbered band names each index and its invariant", async () => {
    const indexes = schema.locator("[data-schema-index]");
    await expect(indexes).toHaveCount(2);
    await expect(
      indexes.first().locator('[data-schema-badge="idx"]'),
    ).toHaveText("INDX 1");
    await expect(
      indexes.first().locator(".table-schema-index-name"),
    ).toHaveText("refresh_jobs_live_key_idx");
    await expect(indexes.first()).toContainText("cache_key");
    await expect(indexes.first()).toContainText("Unique");
    await expect(indexes.first()).toContainText("WHERE status <> 'done'");
    await expect(indexes.first()).toContainText(
      "Ensures one unfinished job per cache key.",
    );
    await expect(
      indexes.last().locator('[data-schema-badge="idx"]'),
    ).toHaveText("INDX 2");
    await expect(indexes.last()).toContainText("status, enqueued_at");
    await expect(indexes.last()).toContainText("refresh_jobs_scan_idx");
  });

  await test.step("the actions menu copies the table name and raw source", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) => {
            document.body.dataset.copiedSchema = value;
            return Promise.resolve();
          },
        },
      });
    });
    await expect(menuButton).toHaveAccessibleName("More actions");
    await menuButton.click();
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Copy table name" }).click();
    expect(await page.locator("body").getAttribute("data-copied-schema")).toBe(
      "catalog.refresh_jobs",
    );
    await expect(menuButton).toHaveAccessibleName("Name copied!");
    await menuButton.click();
    await menu.getByRole("menuitem", { name: "Copy source" }).click();
    expect(await page.locator("body").getAttribute("data-copied-schema")).toBe(
      RAW_TABLE_SCHEMA,
    );
    await expect(menuButton).toHaveAccessibleName("Source copied!");
  });

  await test.step("full screen enlarges the schema and restores it on dismiss", async () => {
    await schema.locator(".table-schema-index-list").evaluate((list) => {
      const entry = list.querySelector("[data-schema-index]");
      if (entry === null) {
        throw new Error("Missing schema index entry");
      }
      for (let index = 0; index < 20; index += 1) {
        list.append(entry.cloneNode(true));
      }
    });
    const expand = schema.getByRole("button", {
      name: "View table schema full screen",
    });
    await expand.scrollIntoViewIfNeeded();
    await expand.click();
    const dialog = page.locator("dialog.component-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("catalog.refresh_jobs");
    await expect(
      dialog.locator("[data-database-table-schema]"),
    ).toHaveAttribute("data-schema-expanded", "");
    await expect(
      dialog.getByRole("button", { name: "Exit full screen" }),
    ).toBeVisible();
    const body = dialog.locator(".table-schema-body");
    const header = dialog.locator(".table-schema-header");
    const lastIndex = dialog.locator("[data-schema-index]").last();
    const beforeScroll = await header.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    const bodyMetrics = await body.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));
    expect(bodyMetrics.overflowY).toBe("auto");
    expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);
    await lastIndex.scrollIntoViewIfNeeded();
    await expect(lastIndex).toBeInViewport();
    const afterScroll = await header.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    );
    expect(afterScroll).toBe(beforeScroll);
    expect(
      await dialog
        .locator("[data-table-scroll-container]")
        .evaluate((element) => getComputedStyle(element).overflowX),
    ).toBe("auto");
    expect(
      await lastIndex
        .locator(".table-schema-index-definition")
        .evaluate((element) => getComputedStyle(element).overflowX),
    ).toBe("auto");
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.component-dialog")).toHaveCount(0);
    await expect(schema).toBeVisible();
    await expect(schema).not.toHaveAttribute("data-schema-expanded", "");
    await schema.locator("[data-schema-index]").evaluateAll((indexes) => {
      for (const index of indexes.slice(2)) {
        index.remove();
      }
    });
  });

  await test.step("a narrow viewport scrolls the grid inside the figure", async () => {
    await page.setViewportSize({ width: 420, height: 900 });
    const container = schema.locator("[data-table-scroll-container]");
    await expect(container).toHaveCount(1);
    const overflow = await container.evaluate(
      (element) => getComputedStyle(element).overflowX,
    );
    expect(overflow).toBe("auto");
    const pageScrolls = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(pageScrolls).toBe(false);
  });
});

test("should fold the schema's Indexes and DDL bands behind tabs", async ({
  page,
  tableSchemaViewerUrl,
}) => {
  await page.goto(tableSchemaViewerUrl);
  const schema = page.locator("[data-database-table-schema]").first();
  const tabs = schema.getByRole("tablist", { name: "Table schema sections" });
  const indexesPanel = schema.locator('[data-schema-section="indexes"]');
  const ddlPanels = schema.locator('[data-schema-section="ddl"]');

  await test.step("the tab bar names every band and selects Indexes first", async () => {
    await expect(tabs.getByRole("tab")).toHaveText([
      /^Indexes$/,
      /^Row security\s*DDL$/,
      /^Triggers\s*DDL$/,
    ]);
    // The badge marks exactly the verbatim-DDL tabs.
    await expect(
      tabs.getByRole("tab", { name: "Indexes" }).locator("[data-schema-badge]"),
    ).toHaveCount(0);
    await expect(
      tabs
        .getByRole("tab", { name: "Row security" })
        .locator('[data-schema-badge="ddl"]'),
    ).toHaveText("DDL");
    await expect(tabs.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(indexesPanel).toBeVisible();
    await expect(ddlPanels.first()).toBeHidden();
    // The tabs name the panels, so the in-panel labels retire.
    await expect(
      indexesPanel.locator(".table-schema-section-label"),
    ).toBeHidden();
  });

  await test.step("tab ids avoid authored document ids", async () => {
    await expect(indexesPanel).toHaveAttribute("id", "table-schema-panel-3");
    await expect(tabs.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "id",
      "table-schema-panel-3-tab",
    );
    expect(
      await page.locator("[id]").evaluateAll((elements) => {
        const ids = elements.map((element) => element.id);
        return new Set(ids).size === ids.length;
      }),
    ).toBe(true);
  });

  await test.step("selecting a DDL tab swaps the visible band", async () => {
    await tabs.getByRole("tab", { name: "Row security" }).click();
    await expect(indexesPanel).toBeHidden();
    await expect(ddlPanels.first()).toBeVisible();
    await expect(ddlPanels.first()).toContainText(
      "CREATE POLICY subscriptions_tenant_read",
    );
  });

  await test.step("the verbatim DDL keeps the shared code copy control", async () => {
    await expect(ddlPanels.first().locator("[data-copy-code]")).toBeVisible();
  });

  await test.step("the DDL stays multi-line instead of one scrolling line", async () => {
    const code = ddlPanels.first().locator("pre code");
    expect(
      await code.evaluate((element) => getComputedStyle(element).whiteSpace),
    ).toBe("pre");
    const metrics = await code.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(metrics.height).toBeGreaterThan(metrics.lineHeight * 4);
  });

  await test.step("arrow keys move the tab focus ring", async () => {
    await tabs.getByRole("tab", { name: "Row security" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Triggers" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(ddlPanels.last()).toContainText(
      "CREATE TRIGGER subscriptions_touch_updated",
    );
    await page.keyboard.press("Home");
    await expect(indexesPanel).toBeVisible();
  });

  await test.step("a schema without DDL bands keeps its plain Indexes band", async () => {
    const plain = page.locator("[data-database-table-schema]").nth(1);
    await expect(plain.getByRole("tablist")).toHaveCount(0);
    await expect(
      plain.locator('[data-schema-section="indexes"]'),
    ).toBeVisible();
  });
});

test("should reorder grid columns and remember the arrangement", async ({
  page,
  tableSchemaViewerUrl,
}) => {
  await page.goto(tableSchemaViewerUrl);
  const firstGrid = page.locator(".table-schema-grid").first();
  const heads = firstGrid.locator("thead th");

  await test.step("headers advertise the reorder affordance", async () => {
    await expect(heads).toHaveText([
      "Column",
      "Type",
      "Constraints",
      "Default",
      "Comment",
    ]);
    await expect(heads.first()).toHaveAttribute("draggable", "true");
    expect(
      await heads
        .first()
        .evaluate((element) => getComputedStyle(element).cursor),
    ).toBe("grab");
  });

  await test.step("arrow keys walk a column across the grid", async () => {
    await heads.filter({ hasText: "Type" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(heads).toHaveText([
      "Column",
      "Constraints",
      "Type",
      "Default",
      "Comment",
    ]);
    // The body cells follow their head: the type cell sits third.
    await expect(
      firstGrid.locator("tbody tr").first().locator("td, th").nth(2),
    ).toHaveClass(/table-schema-cell-type/);
  });

  await test.step("dragging a header drops it at the target column", async () => {
    // The drag pair stays inside the scroll container's visible region;
    // clipped headers cannot start a native drag reliably.
    await heads
      .filter({ hasText: "Constraints" })
      .dragTo(heads.filter({ hasText: "Column" }));
    await expect(heads).toHaveText([
      "Constraints",
      "Column",
      "Type",
      "Default",
      "Comment",
    ]);
  });

  await test.step("dragging right inserts before the indicated target", async () => {
    await heads
      .filter({ hasText: "Constraints" })
      .dragTo(heads.filter({ hasText: "Type" }));
    await expect(heads).toHaveText([
      "Column",
      "Constraints",
      "Type",
      "Default",
      "Comment",
    ]);
  });

  await test.step("every schema on the page follows the same arrangement", async () => {
    await expect(
      page.locator(".table-schema-grid").nth(1).locator("thead th"),
    ).toHaveText(["Column", "Constraints", "Type", "Default", "Comment"]);
  });

  await test.step("the arrangement survives a reload", async () => {
    await page.reload();
    await expect(
      page.locator(".table-schema-grid").first().locator("thead th"),
    ).toHaveText(["Column", "Constraints", "Type", "Default", "Comment"]);
  });

  await test.step("the actions menu resets to the authored layout", async () => {
    const schema = page.locator("[data-database-table-schema]").first();
    await schema.locator("[data-schema-menu-button]").click();
    await schema.getByRole("menuitem", { name: "Reset column layout" }).click();
    await expect(
      page.locator(".table-schema-grid").first().locator("thead th"),
    ).toHaveText(["Column", "Type", "Constraints", "Default", "Comment"]);
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("big-plan:table-schema-columns"),
      ),
    ).toBeNull();
  });
});

test("should jump from an INDX reference to its flashed band entry", async ({
  page,
  tableSchemaViewerUrl,
}) => {
  await page.goto(tableSchemaViewerUrl);
  const schema = page.locator("[data-database-table-schema]").first();
  const tabs = schema.getByRole("tablist", { name: "Table schema sections" });
  const firstEntry = schema.locator('[data-schema-index="1"]');

  await test.step("the jump lands on the Indexes tab even from a DDL tab", async () => {
    await tabs.getByRole("tab", { name: "Row security" }).click();
    await expect(
      schema.locator('[data-schema-section="indexes"]'),
    ).toBeHidden();
    await schema
      .locator('[data-schema-column="customer_id"] [data-schema-indx="1"]')
      .click();
    await expect(tabs.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(firstEntry).toBeInViewport();
  });

  await test.step("the landed entry flashes, then settles", async () => {
    await expect(firstEntry).toHaveClass(/table-schema-index-flash/);
    await expect(firstEntry).not.toHaveClass(/table-schema-index-flash/, {
      timeout: 4_000,
    });
  });

  await test.step("a predicate-only WHERE INDX reference jumps too", async () => {
    const whereMarker = schema.locator(
      '[data-schema-column="status"] [data-schema-indx="2"]',
    );
    await expect(whereMarker).toHaveText("WHERE INDX 2");
    await whereMarker.click();
    const secondEntry = schema.locator('[data-schema-index="2"]');
    await expect(secondEntry).toBeInViewport();
    await expect(secondEntry).toHaveClass(/table-schema-index-flash/);
  });
});

test("should hide and show grid columns from the columns menu", async ({
  page,
  tableSchemaViewerUrl,
}) => {
  await page.goto(tableSchemaViewerUrl);
  const schema = page.locator("[data-database-table-schema]").first();
  const menu = schema.getByRole("menu", { name: "Visible columns" });
  const visibleHeads = (index: number) =>
    page
      .locator(".table-schema-grid")
      .nth(index)
      .locator("thead th:not([hidden])");

  await test.step("unchecking a column hides it in every grid without closing the menu", async () => {
    await schema.locator("[data-schema-columns-button]").click();
    await menu.getByRole("menuitemcheckbox", { name: "Constraints" }).click();
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "Constraints" }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(visibleHeads(0)).toHaveText([
      "Column",
      "Type",
      "Default",
      "Comment",
    ]);
    await expect(visibleHeads(1)).toHaveText([
      "Column",
      "Type",
      "Default",
      "Comment",
    ]);
  });

  await test.step("keyboard reordering steps over the hidden column", async () => {
    await page.keyboard.press("Escape");
    await visibleHeads(0).filter({ hasText: "Type" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(visibleHeads(0)).toHaveText([
      "Column",
      "Default",
      "Type",
      "Comment",
    ]);
  });

  await test.step("the visibility and order survive a reload together", async () => {
    await page.reload();
    await expect(visibleHeads(0)).toHaveText([
      "Column",
      "Default",
      "Type",
      "Comment",
    ]);
  });

  await test.step("rechecking restores the column at its remembered position", async () => {
    await schema.locator("[data-schema-columns-button]").click();
    await menu.getByRole("menuitemcheckbox", { name: "Constraints" }).click();
    await expect(visibleHeads(0)).toHaveText([
      "Column",
      "Constraints",
      "Default",
      "Type",
      "Comment",
    ]);
  });

  await test.step("reset restores the authored layout and clears the preference", async () => {
    await page.keyboard.press("Escape");
    await schema.locator("[data-schema-menu-button]").click();
    await schema.getByRole("menuitem", { name: "Reset column layout" }).click();
    await expect(visibleHeads(0)).toHaveText([
      "Column",
      "Type",
      "Constraints",
      "Default",
      "Comment",
    ]);
    expect(
      await page.evaluate(() =>
        window.localStorage.getItem("big-plan:table-schema-columns"),
      ),
    ).toBeNull();
  });
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
