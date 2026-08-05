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
    affordances: ["maximize", "line-to-annotation hover emphasis"],
    deferred: ["unified/split view"],
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
    affordances: ["choose columns", "maximize"],
    deferred: ["drag column", "index chip jump and flash"],
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
    selector: ".file-tree-diff",
    affordances: ["maximize"],
    deferred: ["unified/split view"],
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
  QuickDecision: {
    selector: '[data-decision-layout="brief"]',
    affordances: ["choose", "confirm", "revise"],
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

  await test.step("DatabaseTableSchema: menu, columns, and maximize", async () => {
    const schema = page.locator("[data-database-table-schema]").first();
    const columns = schema.locator("[data-schema-columns-button]");
    const type = schema.locator('[data-schema-column-toggle="type"]');
    await columns.click();
    await expect(schema.locator("[data-schema-columns-list]")).toBeVisible();
    await type.click();
    await expect(type).toHaveAttribute("aria-checked", "false");
    await expect(schema.locator(".table-schema-head-type")).toBeHidden();
    await type.click();
    await expect(schema.locator(".table-schema-head-type")).toBeVisible();
    await page.keyboard.press("Escape");

    const maximize = schema.locator("[data-figure-maximize]");
    await maximize.click();
    await expect(schema).toHaveAttribute("data-figure-maximized", "");
    await maximize.click();
    await expect(schema).not.toHaveAttribute("data-figure-maximized");
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
