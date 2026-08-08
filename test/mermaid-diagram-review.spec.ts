// Critical browser journey for the static Mermaid viewer: theme selection,
// FlowDiagram-inspired toolbar behavior, SVG target selection, and comments.

import { expect, test } from "./fixtures";

test("should review a static Mermaid SVG through the diagram canvas", async ({
  page,
  mermaidDiagramViewerUrl,
}) => {
  await page.goto(mermaidDiagramViewerUrl);
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });
  const diagram = page.locator("[data-flow-diagram]").first();
  await expect(diagram.locator(".mermaid-diagram-static")).toHaveAttribute(
    "role",
    "group",
  );
  await expect(diagram.getByRole("img")).toHaveCount(0);
  const artboard = diagram.locator("[data-flow-artboard]");
  const source = diagram.locator('[data-flow-node="source"]:visible').first();

  await expect(artboard.locator("svg")).toHaveCount(2);
  await expect(diagram.locator("[data-flow-anchor]")).toHaveCount(9);
  await diagram.hover();
  await expect(diagram.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(
    diagram.getByRole("button", { name: "Comment on this diagram" }),
  ).toBeVisible();
  await expect(
    diagram.getByRole("button", { name: "Comment on this diagram" }),
  ).toHaveText("");
  await expect(
    diagram.getByRole("button", { name: "Fit diagram to width" }),
  ).toHaveAttribute("aria-pressed", "true");
  const viewerCluster = diagram.locator("[data-flow-zoom-controls]");
  const toolbarOrder = await viewerCluster.evaluate((element) =>
    Array.from(element.children).map((child) => {
      if (child.matches(".flow-diagram-zoom")) return "zoom";
      if (child.matches(".flow-diagram-fit")) return "fit";
      if (child.matches("[data-flow-figure-comment]")) return "comment";
      if (child.matches("[data-figure-maximize]")) return "maximize";
      if (child.getAttribute("aria-hidden") === "true") return "separator";
      return "other";
    }),
  );
  expect(toolbarOrder).toEqual([
    "zoom",
    "fit",
    "separator",
    "comment",
    "separator",
    "maximize",
  ]);
  const toolbarGaps = await viewerCluster.evaluate((element) => {
    const boxes = Array.from(element.children).map((child) => {
      const box = child.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    return boxes.slice(1).map((box, index) => box.left - boxes[index].right);
  });
  expect(Math.max(...toolbarGaps)).toBeLessThanOrEqual(6);
  const separators = viewerCluster.locator(':scope > [aria-hidden="true"]');
  await expect(separators).toHaveCount(2);
  await expect(separators.first()).toHaveCSS("width", "1px");
  await expect(separators.first()).toHaveCSS("height", "16px");

  await source.click();
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(source).toHaveAttribute("data-flow-proposed", "removed");
  const removedMarker = diagram.locator("[data-flow-removed-marker]");
  await expect(removedMarker).toHaveCount(1);
  await expect(removedMarker).toHaveAttribute("data-flow-removed-kind", "node");
  await expect(removedMarker.locator("svg polygon")).toHaveCount(1);
  await expect(removedMarker.locator("svg line")).toHaveCount(0);
  const removedPoints = await removedMarker
    .locator("svg polygon")
    .getAttribute("points");
  expect(removedPoints).toMatch(/^2\.55,0 /u);
  expect(removedPoints).toContain("0,2.55");
  const sourceBox = await source.boundingBox();
  const removedBox = await removedMarker.boundingBox();
  expect(removedBox?.width).toBeCloseTo((sourceBox?.width ?? 0) * 0.46, 0);
  expect(removedBox?.height).toBeCloseTo((sourceBox?.height ?? 0) * 0.46, 0);
  const markerAt100 = await removedMarker.boundingBox();
  await diagram.getByRole("button", { name: "Zoom in" }).click();
  const markerAt125 = await removedMarker.boundingBox();
  expect(markerAt125?.width).toBeGreaterThan(markerAt100?.width ?? 0);
  await expect(source).toHaveAccessibleName("Source, proposed for removal");
  const sourceAnchor = await source.getAttribute("data-flow-anchor");
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "dark";
  });
  const darkSource = diagram.locator(
    `[data-flow-anchor="${sourceAnchor}"]:visible`,
  );
  await expect(darkSource).toHaveAttribute("data-flow-selected", "");
  await expect(darkSource).toHaveAttribute("data-flow-proposed", "removed");
  await expect(diagram.locator("[data-flow-removed-marker]")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });
  await expect(source).toHaveAttribute("data-flow-selected", "");
  await expect(source).toHaveAttribute("data-flow-proposed", "removed");
  await expect(diagram.locator('[data-flow-action="revert"]')).toBeVisible();
  const modeSwitch = diagram.locator("[data-flow-mode]");
  await expect(modeSwitch).toBeVisible();
  await modeSwitch.click();
  await expect(modeSwitch).toHaveAttribute("aria-checked", "true");
  await modeSwitch.click();
  await expect(modeSwitch).toHaveAttribute("aria-checked", "false");
  const revertAll = diagram.locator("[data-flow-revert-all]");
  await expect(revertAll).toBeVisible();
  await revertAll.click();
  const revertAllDialog = diagram.getByRole("alertdialog");
  await expect(revertAllDialog).toContainText("Revert edits and deletions?");
  await revertAllDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(source).toHaveAttribute("data-flow-proposed", "removed");
  await revertAll.click();
  await revertAllDialog.getByRole("button", { name: "Revert all" }).click();
  await expect(source).not.toHaveAttribute("data-flow-proposed");
  const edge = diagram.locator('[data-flow-element="edge"]:visible').first();
  const edgeLabel = diagram
    .locator("[data-flow-edge-label-target]:visible")
    .first();
  await edgeLabel.click();
  await expect(edge).toHaveAttribute("data-flow-selected", "");
  await expect(edgeLabel).toHaveAttribute("data-flow-selected", "");
  const markerId = await edge.evaluate((element) => {
    const reference = element.getAttribute("marker-end") ?? "";
    return /url\(#([^)]+)\)/u.exec(reference)?.[1] ?? "";
  });
  expect(markerId).not.toBe("");
  const arrowMarker = diagram.locator(`marker[id="${markerId}"]`);
  await expect(arrowMarker).toHaveAttribute("refX", /.+/u);
  await expect(arrowMarker).toHaveAttribute("refY", /.+/u);
  await expect(arrowMarker).toHaveAttribute("markerWidth", /.+/u);
  await expect(arrowMarker).toHaveAttribute("markerHeight", /.+/u);
  await expect(arrowMarker).toHaveAttribute("markerUnits", /.+/u);
  await expect(arrowMarker).toHaveAttribute("orient", /.+/u);
  const markerShapeBox = await arrowMarker
    .locator("path, polyline, line, polygon")
    .first()
    .evaluate((element) => {
      const box = (element as SVGGraphicsElement).getBBox();
      return { width: box.width, height: box.height };
    });
  expect(markerShapeBox.width).toBeGreaterThan(0);
  expect(markerShapeBox.height).toBeGreaterThan(0);
  const expectedRemovedPaint = await diagram.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--diff-remove-c)";
    element.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(edge).toHaveAttribute("data-flow-proposed", /\bremoved\b/u);
  await expect(edgeLabel).toHaveAttribute("data-flow-proposed", /\bremoved\b/u);
  await expect(arrowMarker).toHaveAttribute(
    "data-flow-proposed",
    /\bremoved\b/u,
  );
  await expect
    .poll(() => edge.evaluate((element) => getComputedStyle(element).stroke))
    .toBe(expectedRemovedPaint);
  await expect
    .poll(() =>
      arrowMarker
        .locator("path, polyline, line, polygon")
        .first()
        .evaluate((element) => getComputedStyle(element).fill),
    )
    .toBe(expectedRemovedPaint);
  const removedEdgeMarker = diagram.locator("[data-flow-removed-marker]");
  await expect(removedEdgeMarker).toHaveAttribute(
    "data-flow-removed-kind",
    "edge",
  );
  const removedEdgeBox = await removedEdgeMarker.boundingBox();
  expect(removedEdgeBox?.width).toBeCloseTo(16, 0);
  expect(removedEdgeBox?.height).toBeCloseTo(16, 0);
  await page.keyboard.press("Delete");

  await diagram.locator("[data-figure-maximize]").click();
  await expect(diagram).toHaveAttribute("data-figure-maximized", "");
  await expect(
    diagram.getByRole("button", { name: "Comment on this diagram" }),
  ).toBeVisible();
  const wholeFigureComment = diagram.getByRole("button", {
    name: "Comment on this diagram",
  });
  await wholeFigureComment.click();
  await diagram.getByRole("button", { name: "Cancel" }).click();
  await expect(wholeFigureComment).toBeFocused();
  await wholeFigureComment.click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Whole figure context in maximize.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(wholeFigureComment).toBeFocused();
  await diagram.locator("[data-figure-maximize]").click();
  const exitAlert = diagram.getByRole("alertdialog");
  await expect(exitAlert).toBeVisible();
  await exitAlert.getByRole("button", { name: "Exit full screen" }).click();
  await expect(diagram).not.toHaveAttribute("data-figure-maximized");

  await source.click();
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeVisible();
  await diagram.locator('[data-flow-action="comment"]').click();
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeHidden();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Keep this source anchored.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    diagram.getByRole("button", { name: "Add 2 notes to plan feedback" }),
  ).toBeVisible();
  await expect(source).toHaveAccessibleName("Source, 1 comment");
  const sourceCommentMarker = diagram.locator(
    `[data-flow-comment-marker][data-flow-comment-anchor="${sourceAnchor}"]`,
  );
  await expect(diagram.locator("[data-flow-comment-marker]")).toHaveCount(2);
  await expect(sourceCommentMarker).toBeVisible();
  await expect(sourceCommentMarker).toHaveCSS("z-index", "21");
  await expect(
    sourceCommentMarker.locator('[data-lucide="message-square"]'),
  ).toBeVisible();
  await sourceCommentMarker.click();
  const inlineThread = diagram.locator(".flow-diagram-comment-thread");
  await expect(inlineThread).toBeVisible();
  await expect(inlineThread).toContainText("Keep this source anchored.");
  await page.keyboard.press("Escape");
  await expect(inlineThread).toBeHidden();
  await expect(sourceCommentMarker).toBeFocused();
  await sourceCommentMarker.click();
  await expect(inlineThread).toBeVisible();
  await inlineThread.getByRole("button", { name: "Close comment" }).click();
  await expect(inlineThread).toBeHidden();
  await expect(sourceCommentMarker).toBeFocused();
  await expect
    .poll(() =>
      sourceCommentMarker.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [Math.round(rect.width), Math.round(rect.height)];
      }),
    )
    .toEqual([20, 20]);

  const footer = diagram.locator("[data-flow-diagram-footer]");
  await footer.click();
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeVisible();
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Footer context.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(footer).toHaveAccessibleName("Diagram footer, 1 comment");
  await expect(footer.locator("[data-flow-comment-marker]")).toHaveCount(1);

  await diagram.focus();
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeHidden();
  await diagram.hover();
  await diagram
    .getByRole("button", { name: "Comment on this diagram" })
    .click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Whole figure context.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(diagram).toHaveAccessibleName(/2 comments/);

  const figureCommentMarker = diagram.locator(
    '[data-flow-comment-marker][data-flow-comment-anchor="component/MermaidDiagram#1"]',
  );
  await expect(figureCommentMarker).toBeVisible();
  await figureCommentMarker.click();
  await expect(inlineThread).toBeVisible();
  await expect(inlineThread).toContainText("Whole figure context.");
  await inlineThread.getByRole("button", { name: "Close comment" }).click();

  await diagram.locator("[data-figure-maximize]").click();
  await expect(diagram).toHaveAttribute("data-figure-maximized", "");
  const figureToolbarComment = diagram.locator("[data-flow-figure-comment]");
  const figureToolbarCommentBox = await figureToolbarComment.boundingBox();
  const figureCommentMarkerBox = await figureCommentMarker.boundingBox();
  expect(figureCommentMarkerBox?.x).toBeGreaterThanOrEqual(
    figureToolbarCommentBox?.x ?? 0,
  );
  expect(
    (figureCommentMarkerBox?.x ?? 0) - (figureToolbarCommentBox?.x ?? 0),
  ).toBeLessThan((figureToolbarCommentBox?.width ?? 0) + 12);
  const sourceTrayItem = diagram
    .locator(".flow-collector-item")
    .filter({ hasText: "Keep this source anchored." });
  await expect(sourceTrayItem).toBeVisible();
  const figureTrayItem = diagram
    .locator(".flow-collector-item")
    .filter({ hasText: "Whole figure context." });
  await figureCommentMarker.click();
  await expect(figureTrayItem).toHaveAttribute("data-flow-comment-flash", "");
  await page.keyboard.press("Escape");
  await expect(diagram.getByRole("alertdialog")).toBeVisible();
  await diagram
    .getByRole("alertdialog")
    .getByRole("button", { name: "Exit full screen" })
    .click();
  await expect(diagram).not.toHaveAttribute("data-figure-maximized");

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    await expect
      .poll(() =>
        diagram
          .locator(`[data-mermaid-theme="${theme}"]`)
          .evaluate((element) => {
            const svg = element.querySelector("svg");
            return svg === null ? "missing" : getComputedStyle(element).display;
          }),
      )
      .toBe("block");
  }

  await expect(artboard).toHaveScreenshot("mermaid-diagram.png", {
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowToolbar = await viewerCluster.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const targets = Array.from(element.querySelectorAll("button")).filter(
      (button) => !button.hidden,
    );
    return {
      right: rect.right,
      centers: targets.map((target) => {
        const box = target.getBoundingClientRect();
        return box.top + box.height / 2;
      }),
      widths: targets
        .filter(
          (target) =>
            !target.matches(".mermaid-diagram-toolbar-comment-marker"),
        )
        .map((target) => target.getBoundingClientRect().width),
    };
  });
  expect(narrowToolbar.right).toBeLessThanOrEqual(390);
  expect(
    Math.max(...narrowToolbar.centers) - Math.min(...narrowToolbar.centers),
  ).toBeLessThan(1);
  expect(Math.min(...narrowToolbar.widths)).toBeGreaterThanOrEqual(44);
});

test("should expose stable selectable targets in supported static gallery types", async ({
  page,
  mermaidGalleryViewerUrl,
}) => {
  await page.goto(mermaidGalleryViewerUrl);
  const diagrams = page.locator("[data-flow-diagram]");
  const staticIndexes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    for (const index of staticIndexes) {
      await expect
        .poll(() =>
          diagrams
            .nth(index)
            .locator(`[data-mermaid-theme="${theme}"] svg`)
            .evaluate((svg) => svg.getBoundingClientRect().height),
        )
        .toBeGreaterThan(0);
    }
  }
  const journey = diagrams.nth(16);
  for (const label of ["Read the diagram", "Leave feedback"]) {
    await expect(journey.locator("svg").filter({ hasText: label })).toHaveCount(
      2,
    );
  }
  for (const index of [10, 11, 12, 13, 15, 17, 18, 19]) {
    await expect(
      diagrams
        .nth(index)
        .locator(
          '[data-flow-element]:not([data-flow-element="figure"]):visible',
        )
        .first(),
    ).toBeVisible();
  }
  const flow = diagrams.nth(0);
  const flowEdge = flow.locator('[data-flow-element="edge"]:visible').first();
  const flowEdgeHit = flow.locator("[data-flow-edge-hit]:visible").first();
  await flowEdgeHit.scrollIntoViewIfNeeded();
  await expect(flowEdgeHit).toHaveAttribute("stroke-width", "32");
  await flowEdgeHit.click();
  await expect(flowEdge).toHaveAttribute("data-flow-selected", "");

  const sequence = diagrams.nth(10);
  const sequenceNode = sequence
    .locator('[data-flow-element="node"]:visible')
    .first();
  await sequenceNode.scrollIntoViewIfNeeded();
  await sequenceNode.click();
  await expect(sequenceNode).toHaveAttribute("data-flow-selected", "");
  await page.keyboard.press("Delete");
  await expect(sequenceNode).toHaveAttribute("data-flow-proposed", "removed");
  await expect(
    sequence.locator(
      '[data-flow-element="edge"][data-flow-proposed~="removed-incident"]:visible',
    ),
  ).toHaveCount(0);
  await page.keyboard.press("Delete");
  const message = sequence
    .locator("[data-flow-edge-label-target]:visible")
    .first();
  await message.scrollIntoViewIfNeeded();
  await message.click();
  await expect(
    sequence.locator('[data-flow-element="edge"][data-flow-selected]'),
  ).toHaveCount(1);
});

test("should restore Mermaid review state after a collapsed theme change", async ({
  page,
  mermaidDiagramViewerUrl,
}) => {
  await page.goto(mermaidDiagramViewerUrl);
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });
  const diagram = page.locator("[data-flow-diagram]").first();
  const source = diagram.locator('[data-flow-node="source"]:visible').first();
  const anchor = await source.getAttribute("data-flow-anchor");
  await source.click();
  await page.keyboard.press("Delete");
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Keep this state through collapse.");
  await page.keyboard.press("ControlOrMeta+Enter");

  const slide = diagram.locator("xpath=ancestor::*[@data-collapsible][1]");
  const collapse = slide.locator(
    ":scope > [data-collapse-header] [data-collapse-toggle]",
  );
  await collapse.click();
  await expect(collapse).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "dark";
  });
  await collapse.click();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");

  const darkSource = diagram.locator(`[data-flow-anchor="${anchor}"]:visible`);
  await expect(darkSource).toHaveAttribute("data-flow-selected", "");
  await expect(darkSource).toHaveAttribute("data-flow-proposed", "removed");
  const removedMarker = diagram.locator("[data-flow-removed-marker]");
  await expect(removedMarker).toBeVisible();
  await expect
    .poll(() => removedMarker.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(0);
  const commentMarker = diagram.locator(
    `[data-flow-comment-marker][data-flow-comment-anchor="${anchor}"]`,
  );
  await expect(commentMarker).toBeVisible();
  await expect
    .poll(() => commentMarker.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(0);
});

test("should keep background comments open when Revert All closes with Escape", async ({
  page,
  mermaidDiagramViewerUrl,
}) => {
  await page.goto(mermaidDiagramViewerUrl);
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });

  const diagram = page.locator("[data-flow-diagram]").first();
  const source = diagram.locator('[data-flow-node="source"]:visible').first();
  const compose = diagram.locator(".flow-diagram-compose");

  await source.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await compose.locator("textarea").fill("Keep this saved comment.");
  await page.keyboard.press("ControlOrMeta+Enter");
  const commentMarker = diagram.locator(
    '[data-flow-comment-marker][data-flow-comment-anchor$="/node/source"]',
  );
  await expect(commentMarker).toBeVisible();

  await source.click();
  await page.keyboard.press("Delete");
  const revertAll = diagram.locator("[data-flow-revert-all]");
  const revertAllDialog = diagram.getByRole("alertdialog");
  await expect(revertAll).toBeVisible();

  await diagram.locator('[data-flow-action="comment"]').click();
  await compose.locator("textarea").fill("Keep this draft open.");
  await revertAll.click();
  await expect(revertAllDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(revertAllDialog).toBeHidden();
  await expect(compose).toBeVisible();
  await expect(compose.locator("textarea")).toHaveValue(
    "Keep this draft open.",
  );
  await compose.getByRole("button", { name: "Cancel" }).click();

  await commentMarker.click();
  const commentThread = diagram.locator(".flow-diagram-comment-thread");
  await expect(commentThread).toBeVisible();
  await revertAll.click();
  await expect(revertAllDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(revertAllDialog).toBeHidden();
  await expect(commentThread).toBeVisible();
});
