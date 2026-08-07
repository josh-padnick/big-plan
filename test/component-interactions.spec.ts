// Registry-level behavioral gate for the complete component gallery. Pixel
// history proves presentation; this suite separately proves that every
// authorable component is accounted for and that each live affordance still
// responds to a real browser gesture.

import { REGISTERED_COMPONENT_NAMES } from "../src/components/_registration/registry.js";
import { expect, test } from "./fixtures";

type InteractionContract = {
  readonly selector: string;
  readonly affordances: ReadonlyArray<string>;
  readonly deferred?: ReadonlyArray<string>;
};

const COMPONENT_INTERACTIONS = {
  Callout: {
    selector: "[data-callout]",
    affordances: [],
  },
  CodeDiff: {
    selector: "[data-code-diff]",
    affordances: [
      "maximize",
      "unified/split view",
      "line-to-annotation hover emphasis",
    ],
  },
  CodeSnippet: {
    selector: "[data-code-snippet]",
    affordances: ["maximize", "line-to-annotation hover emphasis"],
  },
  DataTable: {
    selector: "[data-data-table]",
    affordances: [
      "filter",
      "sort",
      "drag column",
      "choose columns",
      "text fit",
      "maximize",
    ],
  },
  DatabaseTableSchema: {
    selector: "[data-database-table-schema]",
    affordances: [
      "choose columns",
      "drag column",
      "keyboard column reorder",
      "reset column layout",
      "index chip jump and flash",
      "maximize",
    ],
  },
  Decision: {
    selector: "[data-decision]",
    affordances: ["choose", "confirm", "revise"],
  },
  DecisionAnalysis: {
    selector: '[data-decision-layout="matrix"]',
    affordances: ["inspect rationale"],
  },
  FileTree: {
    selector: "[data-file-tree]",
    affordances: [],
  },
  FileTreeDiff: {
    selector: "[data-file-tree-diff]",
    affordances: ["combined/side-by-side view", "maximize"],
  },
  FlowDiagram: {
    selector: "[data-flow-diagram]",
    affordances: ["zoom", "reset zoom", "fit", "maximize", "comment"],
  },
  GraphqlOperation: {
    selector: "[data-graphql-operation]",
    affordances: [],
  },
  GrpcMethod: {
    selector: "[data-grpc-method]",
    affordances: [],
  },
  HttpEndpoint: {
    selector: "[data-http-endpoint]",
    affordances: [],
  },
  Part: {
    selector: "[data-part]",
    affordances: ["collapse and expand"],
  },
  QuickSummary: {
    selector: "[data-quick-summary]",
    affordances: [],
  },
  Slide: {
    selector: '[data-slide-type="desired-experience"]',
    affordances: [],
  },
  QuickDecision: {
    selector: '[data-decision-layout="brief"]',
    affordances: ["choose", "confirm", "revise"],
  },
  Slide: {
    selector: "[data-slide]",
    affordances: ["collapse and expand"],
  },
  TableOfContents: {
    selector: "[data-table-of-contents]",
    affordances: ["navigate"],
  },
  Wireframe: {
    selector: "[data-wireframe]",
    affordances: ["switch screen"],
  },
} as const satisfies Record<string, InteractionContract>;

test("should account for every registered component in the interaction gate", async ({
  page,
  allComponentsViewerUrl,
}) => {
  expect(Object.keys(COMPONENT_INTERACTIONS).sort()).toEqual(
    [...REGISTERED_COMPONENT_NAMES].sort(),
  );

  await page.goto(allComponentsViewerUrl);
  for (const [name, contract] of Object.entries(COMPONENT_INTERACTIONS)) {
    await test.step(name, async () => {
      expect(await page.locator(contract.selector).count()).toBeGreaterThan(0);
    });
  }
});

test("should exercise every live component affordance with browser gestures", async ({
  page,
  allComponentsViewerUrl,
  wireframeViewerUrl,
}) => {
  test.setTimeout(60_000);
  await page.goto(allComponentsViewerUrl);

  await test.step("TableOfContents: navigate", async () => {
    await page
      .locator("[data-table-of-contents-row]")
      .filter({ hasText: "Review decisions" })
      .click();
    await expect(page).toHaveURL(/#review-decisions$/u);
  });

  await test.step("column reorder: cursor states stay scoped to movable headers", async () => {
    const movable = page.locator(
      "[data-data-table] thead [data-column-reorderable], [data-database-table-schema] thead [data-column-reorderable]",
    );
    const plainTableHeader = page
      .locator(
        "article table:not(.data-table-grid):not(.table-schema-grid) thead th",
      )
      .first();
    await expect(movable).not.toHaveCount(0);
    await expect(plainTableHeader).toHaveCount(1);
    await expect(movable.first()).toHaveCSS("cursor", "grab");
    await movable.first().hover();
    await expect(movable.first()).toHaveCSS("cursor", "grab");
    await expect(plainTableHeader).toHaveCSS("cursor", "auto");
    await plainTableHeader.hover();
    await expect(plainTableHeader).toHaveCSS("cursor", "auto");
  });

  await test.step("Part: collapse and expand", async () => {
    const part = page.locator('[data-collapsible="part"]').first();
    const toggle = part.locator(
      ":scope > [data-collapse-header] > [data-collapse-toggle]",
    );
    await toggle.click();
    await expect(part).toHaveAttribute("data-collapsed", "");
    await toggle.click();
    await expect(part).not.toHaveAttribute("data-collapsed");
  });

  await test.step("Decision: choose, confirm, and revise", async () => {
    const decision = page.locator('[data-decision-layout="rows"]').first();
    await decision.locator("[data-decision-choice]").first().check();
    await decision.locator("[data-decision-confirm]").click();
    await expect(decision.locator("[data-decision-answer]")).toBeVisible();
    await decision.locator("[data-decision-change]").click();
    await expect(decision.locator("[data-decision-footer]")).toBeVisible();
  });

  await test.step("QuickDecision: choose, confirm, and revise", async () => {
    const decision = page.locator('[data-decision-layout="brief"]').first();
    await decision.locator("[data-decision-choice]").first().check();
    await decision.locator("[data-decision-confirm]").click();
    await expect(decision.locator("[data-decision-answer]")).toBeVisible();
    await decision.locator("[data-decision-change]").click();
    await expect(decision.locator("[data-decision-footer]")).toBeVisible();
  });

  await test.step("DecisionAnalysis: inspect rationale", async () => {
    const analysis = page.locator('[data-decision-layout="matrix"]').first();
    const rationale = analysis.locator("[data-decision-definition]").first();
    await rationale.locator("summary").hover();
    await expect(rationale).toHaveAttribute("open", "");
  });

  await test.step("CodeDiff: switch views by pointer and keyboard", async () => {
    const diff = page.locator(COMPONENT_INTERACTIONS.CodeDiff.selector).first();
    const unified = diff.getByRole("button", { name: "Unified view" });
    const split = diff.getByRole("button", { name: "Side-by-side view" });

    await expect(diff.getByRole("group", { name: "Diff view" })).toBeVisible();
    await expect(unified).toHaveAttribute("aria-pressed", "true");
    await split.click();
    await expect(diff).toHaveAttribute("data-diff-view", "split");
    await expect(split).toHaveAttribute("aria-pressed", "true");
    await expect(unified).toHaveAttribute("aria-pressed", "false");
    await expect(diff.locator('[data-diff-content="split"]')).toBeVisible();

    await page.reload();
    await expect(diff).toHaveAttribute("data-diff-view", "split");
    await unified.focus();
    await page.keyboard.press("Space");
    await expect(diff).toHaveAttribute("data-diff-view", "unified");
    await expect(unified).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(diff).toHaveAttribute("data-diff-view", "unified");
  });

  await test.step("CodeDiff: cross-highlight an annotation and its lines", async () => {
    const diff = page.locator(COMPONENT_INTERACTIONS.CodeDiff.selector).first();
    const annotation = diff.locator("[data-annotation-id]").first();
    const annotationId = await annotation.getAttribute("data-annotation-id");
    expect(annotationId).not.toBeNull();
    const line = diff
      .locator(`[data-annotation-anchor~="${annotationId ?? ""}"]`)
      .first();

    await line.hover();
    await expect(annotation).toHaveClass(/annotation-hover/u);
    await page.mouse.move(0, 0);
    await annotation.hover();
    await expect(line).toHaveClass(/annotation-hover/u);
  });

  await test.step("CodeSnippet: cross-highlight an annotation and its lines", async () => {
    const snippet = page
      .locator(COMPONENT_INTERACTIONS.CodeSnippet.selector)
      .first();
    const annotation = snippet.locator("[data-snippet-annotation]").first();
    const line = snippet.locator("[data-snippet-annotated]").first();

    await line.hover();
    await expect(annotation).toHaveClass(/annotation-hover/u);
    await page.mouse.move(0, 0);
    await annotation.hover();
    await expect(line).toHaveClass(/annotation-hover/u);
  });

  await test.step("FileTreeDiff: switch views by pointer and keyboard", async () => {
    const tree = page
      .locator(COMPONENT_INTERACTIONS.FileTreeDiff.selector)
      .first();
    const combined = tree.getByRole("button", { name: "Combined view" });
    const sideBySide = tree.getByRole("button", {
      name: "Side-by-side view",
    });

    await expect(
      tree.getByRole("group", { name: "File tree diff view" }),
    ).toBeVisible();
    await expect(combined).toHaveAttribute("aria-pressed", "true");
    await sideBySide.click();
    await expect(tree).toHaveAttribute("data-tree-view", "before-after");
    await expect(sideBySide).toHaveAttribute("aria-pressed", "true");
    await expect(combined).toHaveAttribute("aria-pressed", "false");
    await expect(
      tree.locator('[data-tree-content="before-after"]'),
    ).toBeVisible();

    await page.reload();
    await expect(tree).toHaveAttribute("data-tree-view", "before-after");
    await combined.focus();
    await page.keyboard.press("Space");
    await expect(tree).toHaveAttribute("data-tree-view", "combined");
    await expect(combined).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(tree).toHaveAttribute("data-tree-view", "combined");
  });

  for (const figure of [
    {
      name: "CodeDiff",
      selector: COMPONENT_INTERACTIONS.CodeDiff.selector,
    },
    {
      name: "CodeSnippet",
      selector: COMPONENT_INTERACTIONS.CodeSnippet.selector,
    },
    {
      name: "FileTreeDiff",
      selector: COMPONENT_INTERACTIONS.FileTreeDiff.selector,
    },
  ]) {
    await test.step(`${figure.name}: maximize and restore`, async () => {
      const frame = page.locator(figure.selector).first();
      const maximize = frame.locator("[data-figure-maximize]");
      await maximize.click();
      await expect(frame).toHaveAttribute("data-figure-maximized", "");
      await maximize.click();
      await expect(frame).not.toHaveAttribute("data-figure-maximized");
    });
  }

  await test.step("DatabaseTableSchema: reorder, persist, reset, and maximize", async () => {
    const schema = page.locator("[data-database-table-schema]").first();
    const headers = schema.locator(
      ".table-schema-grid thead [data-schema-grid-column]",
    );
    const authoredOrder = [
      "column",
      "type",
      "constraints",
      "default",
      "comment",
    ];
    await expect(headers).toHaveCount(authoredOrder.length);

    const first = headers.first();
    const firstKey = await first.getAttribute("data-schema-grid-column");
    await expect(first).toHaveAttribute("draggable", "true");
    await expect(first).toHaveCSS("cursor", "grab");
    await first.evaluate((element) => {
      element.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        }),
      );
    });
    await expect(first).toHaveCSS("cursor", "grabbing");
    await first.dispatchEvent("dragend");
    await expect(first).toHaveCSS("cursor", "grab");
    await expect(first).toHaveAttribute(
      "aria-keyshortcuts",
      "ArrowLeft ArrowRight",
    );
    const second = headers.nth(1);
    const secondBox = await second.boundingBox();
    expect(secondBox).not.toBeNull();
    await first.dragTo(second, {
      targetPosition: {
        x: (secondBox?.width ?? 2) - 2,
        y: (secondBox?.height ?? 2) / 2,
      },
    });
    await expect(headers.nth(1)).toHaveAttribute(
      "data-schema-grid-column",
      firstKey ?? "",
    );

    const moved = schema.locator(
      `.table-schema-grid thead [data-schema-grid-column="${firstKey ?? ""}"]`,
    );
    await moved.focus();
    await page.keyboard.press("ArrowRight");
    await expect(headers.nth(2)).toHaveAttribute(
      "data-schema-grid-column",
      firstKey ?? "",
    );
    await expect(schema.locator("[data-schema-reorder-status]")).toContainText(
      "position 3 of 5",
    );

    await page.reload();
    await expect(headers.nth(2)).toHaveAttribute(
      "data-schema-grid-column",
      firstKey ?? "",
    );

    const columns = schema.locator("[data-schema-columns-button]");
    const type = schema.locator('[data-schema-column-toggle="type"]');
    await columns.click();
    await expect(schema.locator("[data-schema-columns-list]")).toBeVisible();
    await type.click();
    await expect(type).toHaveAttribute("aria-checked", "false");
    await expect(schema.locator(".table-schema-head-type")).toBeHidden();
    await page.reload();
    await expect(type).toHaveAttribute("aria-checked", "false");
    await expect(schema.locator(".table-schema-head-type")).toBeHidden();
    await columns.click();
    await schema.locator("[data-schema-reset-columns]").click();
    await page.reload();
    await expect(schema.locator(".table-schema-head-type")).toBeVisible();
    await expect(type).toHaveAttribute("aria-checked", "true");
    for (const [index, key] of authoredOrder.entries()) {
      await expect(headers.nth(index)).toHaveAttribute(
        "data-schema-grid-column",
        key,
      );
    }

    const maximize = schema.locator("[data-figure-maximize]");
    await maximize.click();
    await expect(schema).toHaveAttribute("data-figure-maximized", "");
    await maximize.click();
    await expect(schema).not.toHaveAttribute("data-figure-maximized");
  });

  await test.step("DatabaseTableSchema: jump from an index chip by pointer and keyboard", async () => {
    const schema = page.locator("[data-database-table-schema]").first();
    const marker = schema
      .getByRole("button", {
        name: "Jump to index 1",
      })
      .first();
    const target = schema.locator('[data-schema-index="1"]');

    await expect(marker).toHaveAttribute("aria-controls", /.+/u);
    await marker.click();
    await expect(target).toBeFocused();
    await expect(target).toHaveClass(/table-schema-index-flash/u);

    await marker.focus();
    await page.keyboard.press("Enter");
    await expect(target).toBeFocused();
    await expect(target).toHaveClass(/table-schema-index-flash/u);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await marker.click();
    await expect(target).toBeFocused();
    await expect(target).not.toHaveClass(/table-schema-index-flash/u);
    await expect(target).toHaveCSS("transition-duration", "0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  await test.step("DataTable: filter, sort, menus, drag, and maximize", async () => {
    const table = page.locator("[data-data-table]").first();
    const filter = table.locator("[data-table-filter-input]");
    await filter.fill("Renderer");
    await expect(table.locator("[data-table-count]")).toContainText("1");
    await filter.press("Escape");
    await expect(filter).toHaveValue("");

    const ownerSort = table.locator('[data-table-sort="1"]');
    await ownerSort.click();
    await expect(ownerSort.locator("xpath=..")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await table.locator("[data-table-fit-button]").click();
    await table.locator('[data-table-fit-choice="truncate"]').click();
    await expect(table).toHaveAttribute("data-table-fit", "truncate");
    await table.locator('[data-table-fit-choice="wrap"]').click();
    await expect(table).toHaveAttribute("data-table-fit", "wrap");

    await table.locator("[data-table-menu-button]").click();
    const evidenceToggle = table.locator('[data-table-column-toggle="3"]');
    await evidenceToggle.click();
    await expect(evidenceToggle).toHaveAttribute("aria-checked", "false");
    await evidenceToggle.click();
    await page.keyboard.press("Escape");

    const headers = table.locator("thead [data-table-column]");
    const firstColumn = await headers.first().getAttribute("data-table-column");
    const second = headers.nth(1);
    await expect(headers.first()).toHaveCSS("cursor", "grab");
    await headers.first().evaluate((element) => {
      element.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        }),
      );
    });
    await expect(headers.first()).toHaveCSS("cursor", "grabbing");
    await headers.first().dispatchEvent("dragend");
    await expect(headers.first()).toHaveCSS("cursor", "grab");
    const secondBox = await second.boundingBox();
    expect(secondBox).not.toBeNull();
    await headers.first().dragTo(second, {
      targetPosition: {
        x: (secondBox?.width ?? 2) - 2,
        y: (secondBox?.height ?? 2) / 2,
      },
    });
    await expect(headers.nth(1)).toHaveAttribute(
      "data-table-column",
      firstColumn ?? "",
    );

    const maximize = table.locator("[data-figure-maximize]");
    await maximize.click();
    await expect(table).toHaveAttribute("data-figure-maximized", "");
    await maximize.click();
    await expect(table).not.toHaveAttribute("data-figure-maximized");
  });

  await test.step("FlowDiagram: zoom, fit, maximize, and comment", async () => {
    const diagram = page.locator("[data-flow-diagram]").first();
    const readout = diagram.locator("[data-flow-zoom-readout]");
    const fit = diagram.getByRole("button", {
      name: "Fit diagram to width",
    });
    await diagram.hover();
    await diagram.getByRole("button", { name: "Zoom out" }).click();
    await expect(fit).toHaveAttribute("aria-pressed", "false");
    await diagram.getByRole("button", { name: "Reset zoom to 100%" }).click();
    await expect(readout).toHaveText("100%");
    await fit.click();
    await expect(fit).toHaveAttribute("aria-pressed", "true");

    const maximize = diagram.locator("[data-figure-maximize]");
    await maximize.click();
    await expect(diagram).toHaveAttribute("data-figure-maximized", "");
    await maximize.click();
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");

    const node = diagram.locator('[data-flow-node="plan-source"]');
    await node.click();
    await diagram.locator('[data-flow-action="comment"]').click();
    await diagram
      .locator(".flow-diagram-compose textarea")
      .fill("Keep the source boundary explicit.");
    await diagram
      .locator('.flow-diagram-compose button[data-variant="primary"]')
      .click();
    await expect(node.locator("[data-flow-comment-marker]")).toBeVisible();
  });

  await test.step("Wireframe: switch screens", async () => {
    await page.goto(wireframeViewerUrl);
    const lesson = page.locator('[data-wireframe-screen="loan-lesson"]');
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(lesson).toBeVisible();
  });
});
