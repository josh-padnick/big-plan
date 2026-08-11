// Critical browser journeys for reviewing a FlowDiagram: edits and comments
// remain faithful, canvas state survives reader interactions, and the review
// chrome occupies the correct place in each view.

import { expect, test } from "./fixtures";

test("should render cleared node text as a struck-through edit", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const label = node.locator('[data-flow-field="label"]');

  await test.step("clear the selected label through the editing affordance", async () => {
    await node.click();
    await page.keyboard.press("Enter");
    await expect(label).toHaveAttribute("data-flow-editing", "");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
  });

  await test.step("keep the authored text visible as the removal side of the diff", async () => {
    await expect(label).toHaveText("");
    const original = node.locator(".flow-diagram-original");
    await expect(original).toHaveText("Author once");
    await expect(original).toBeVisible();
    await expect(original).toHaveCSS("text-decoration-line", "line-through");
    await expect(node).not.toHaveAttribute("data-flow-proposed", /removed/);
  });
});

test("should preserve authored markup when an edit is canceled or cleared", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").nth(1);
  const body = diagram
    .locator('[data-flow-node="skill"]')
    .locator('[data-flow-field="body"]');
  const original = "Calls big-plan guidance in its workflow";

  await body.dblclick();
  await body.fill("Temporary replacement");
  await page.keyboard.press("Escape");
  await expect(body).toHaveText(original);
  await expect(body.locator("code")).toHaveText("big-plan guidance");

  await body.dblclick();
  await body.fill(original);
  await page.keyboard.press("Enter");
  await expect(body).toHaveText(original);
  await expect(body.locator("code")).toHaveText("big-plan guidance");
  await expect(body).not.toHaveAttribute("data-flow-edited");
});

test("should hold the original-view switch state and revert every proposal", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const label = diagram.locator(
    '[data-flow-node="authored"] [data-flow-field="label"]',
  );
  const modeSwitch = diagram.locator("[data-flow-mode]");
  const revertAll = diagram.locator("[data-flow-revert-all]");

  // Both proposal controls stay out of the way until there is a proposal.
  await expect(modeSwitch).toBeHidden();
  await expect(revertAll).toBeHidden();

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Preserve this saved comment.");
  await diagram
    .locator('.flow-diagram-compose button[data-variant="primary"]')
    .click();
  const commentMarker = node.locator("[data-flow-comment-marker]");
  await expect(commentMarker).toBeVisible();
  await expect(commentMarker).toHaveAttribute("aria-hidden", "true");
  await expect(node.getByRole("button", { name: /Open comment/u })).toHaveCount(
    0,
  );

  await label.dblclick();
  await label.fill("Author carefully");
  await page.getByRole("heading").first().click();
  await expect(modeSwitch).toBeVisible();
  await expect(revertAll).toBeVisible();
  await expect(revertAll).toHaveAttribute(
    "aria-label",
    "Revert edits and deletions",
  );

  // The switch reports its own state, so a reader can see which view is on
  // without reading the diagram to work it out.
  await expect(modeSwitch).toHaveAttribute("aria-checked", "false");
  await modeSwitch.click();
  await expect(modeSwitch).toHaveAttribute("aria-checked", "true");
  await expect(diagram).toHaveAttribute("data-flow-original", "");
  await expect(label).toHaveText("Author once");

  await modeSwitch.click();
  await expect(modeSwitch).toHaveAttribute("aria-checked", "false");
  await expect(label).toHaveText("Author carefully");

  // Reverting the last proposal returns the diagram to its authored view and
  // clears the switch with it, so the control never outlives its subject.
  await modeSwitch.click();
  await revertAll.click();
  const revertAllDialog = diagram.getByRole("alertdialog");
  await expect(revertAllDialog).toContainText("Revert edits and deletions?");
  await expect(revertAllDialog).toContainText(
    "This removes every pending edit and deletion from this diagram. Saved comments remain.",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect(revertAllDialog).toBeVisible();
  await revertAllDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(revertAll).toBeVisible();
  await revertAll.click();
  await revertAllDialog.getByRole("button", { name: "Revert all" }).click();
  await expect(label).toHaveText("Author once");
  await expect(commentMarker).toBeVisible();
  await expect(diagram.locator(".flow-collector-add").first()).toHaveText(
    "Add 1 note to plan feedback",
  );
  await expect(diagram).not.toHaveAttribute("data-flow-original");
  await expect(modeSwitch).toBeHidden();
  await expect(revertAll).toBeHidden();
  await expect(diagram).toBeFocused();
  await expect(page.locator(".flow-diagram-live")).toHaveText(
    "Reverted all edits and deletions on this diagram",
  );
});

test("should preserve work when focus moves outside the diagram", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const label = node.locator('[data-flow-field="label"]');
  const compose = diagram.locator(".flow-diagram-compose");
  const outside = page.getByRole("heading").first();

  await label.dblclick();
  await label.fill("Author carefully");
  await outside.click();
  await expect(label).toHaveText("Author carefully");
  await expect(label).toHaveAttribute("data-flow-edited", "");
  await expect(diagram.locator(".flow-collector-add").first()).toHaveText(
    "Add 1 note to plan feedback",
  );

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await compose.locator("textarea").fill("Keep this unfinished note.");
  await outside.click();
  await expect(compose).toBeVisible();
  await expect(compose.locator("textarea")).toHaveValue(
    "Keep this unfinished note.",
  );
  await expect(diagram.locator(".flow-collector-add").first()).toHaveText(
    "Add 1 note to plan feedback",
  );
});

test("should preserve work across diagram interaction transitions", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const viewport = diagram.locator("[data-flow-viewport]");
  const firstNode = diagram.locator('[data-flow-node="authored"]');
  const firstLabel = firstNode.locator('[data-flow-field="label"]');
  const secondNode = diagram.locator('[data-flow-node="generator"]');
  const secondLabel = secondNode.locator('[data-flow-field="label"]');
  const compose = diagram.locator(".flow-diagram-compose");

  await firstLabel.dblclick();
  await firstLabel.fill("Author deliberately");
  await viewport.click({ position: { x: 4, y: 4 } });
  await expect(firstLabel).toHaveText("Author deliberately");

  await firstLabel.dblclick();
  await firstLabel.fill("Author precisely");
  await secondLabel.dblclick();
  await secondLabel.fill("Generate carefully");
  await page.keyboard.press("Enter");
  await expect(firstLabel).toHaveText("Author precisely");
  await expect(secondLabel).toHaveText("Generate carefully");

  await firstNode.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await compose.locator("textarea").fill("Keep the first target explicit.");
  await compose.getByRole("button", { name: "Comment" }).click();
  await secondNode.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await expect(compose.locator(".flow-diagram-compose-target")).toHaveText(
    'Comment on node "Generate"',
  );
  await expect(diagram.locator(".flow-collector-add").first()).toHaveText(
    "Add 3 notes to plan feedback",
  );
});

test("should leave toolbar keyboard activation to the focused control", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const label = node.locator('[data-flow-field="label"]');
  const zoomIn = diagram.getByRole("button", { name: "Zoom in" });
  const readout = diagram.locator("[data-flow-zoom-readout]");

  await node.click();
  await zoomIn.focus();
  const before = await readout.textContent();
  await page.keyboard.press("Space");

  await expect(label).not.toHaveAttribute("data-flow-editing");
  await expect(zoomIn).toBeFocused();
  await expect(readout).not.toHaveText(before ?? "");
});

test("should group and right-align the diagram viewer controls", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const toolbar = diagram.locator("[data-flow-controls]");
  const viewControls = diagram.locator("[data-flow-zoom-controls]");
  const fit = diagram.getByRole("button", { name: "Fit diagram to width" });
  const reset = diagram.getByRole("button", { name: "Reset zoom to 100%" });
  const readout = diagram.locator("[data-flow-zoom-readout]");

  await diagram.hover();
  await expect(viewControls).toBeVisible();
  await expect(
    diagram.getByRole("group", { name: "Diagram zoom" }),
  ).toBeVisible();
  await expect(fit).toHaveAttribute("aria-pressed", "true");

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);
    await expect
      .poll(() =>
        fit.evaluate((element) => {
          const accent = document.createElement("span");
          accent.style.color = "var(--accent-c)";
          const ink = document.createElement("span");
          ink.style.color = "var(--ink-c)";
          const edge = document.createElement("span");
          edge.style.backgroundColor = "var(--edge-c)";
          const background = document.createElement("span");
          background.style.backgroundColor = "var(--bg)";
          document.body.append(accent, ink, edge, background);
          const style = getComputedStyle(element);
          const accentStyle = getComputedStyle(accent);
          const inkStyle = getComputedStyle(ink);
          const edgeStyle = getComputedStyle(edge);
          const backgroundStyle = getComputedStyle(background);
          const channels = (color: string): ReadonlyArray<string> =>
            color.match(/\d+/gu)?.slice(0, 3) ?? [];
          const result = {
            isAccent: style.color === accentStyle.color,
            isInk: style.color === inkStyle.color,
            hasEdgeBackground:
              channels(style.backgroundColor).join(",") ===
              channels(edgeStyle.backgroundColor).join(","),
            hasRestingBackground:
              channels(style.backgroundColor).join(",") !==
              channels(backgroundStyle.backgroundColor).join(","),
          };
          accent.remove();
          ink.remove();
          edge.remove();
          background.remove();
          return result;
        }),
      )
      .toEqual({
        isAccent: false,
        isInk: false,
        hasEdgeBackground: false,
        hasRestingBackground: true,
      });

    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).toHaveAttribute("data-figure-maximized", "");
    await expect
      .poll(() =>
        fit.evaluate((element) => {
          const reference = document.createElement("span");
          reference.style.color = "var(--ink-c)";
          reference.style.backgroundColor = "var(--edge-c)";
          document.body.append(reference);
          const style = getComputedStyle(element);
          const referenceStyle = getComputedStyle(reference);
          const channels = (color: string): ReadonlyArray<string> =>
            color.match(/\d+/gu)?.slice(0, 3) ?? [];
          const result = {
            isInk: style.color === referenceStyle.color,
            hasEdgeBackground:
              channels(style.backgroundColor).join(",") ===
              channels(referenceStyle.backgroundColor).join(","),
          };
          reference.remove();
          return result;
        }),
      )
      .toEqual({ isInk: true, hasEdgeBackground: true });
    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");
  }

  const geometry = await toolbar.evaluate((element) => {
    const controls = element.querySelector("[data-flow-zoom-controls]");
    const maximize = element.querySelector("[data-figure-maximize]");
    const buttons = Array.from(
      element.querySelectorAll<HTMLButtonElement>(
        "[data-flow-zoom], [data-figure-maximize]",
      ),
    );
    if (controls === null || maximize === null) return null;
    const toolbarRect = element.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const maximizeRect = maximize.getBoundingClientRect();
    return {
      controlsLeft: controlsRect.left,
      toolbarCenter: toolbarRect.left + toolbarRect.width / 2,
      rightInset: toolbarRect.right - maximizeRect.right,
      targets: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry?.controlsLeft).toBeGreaterThan(geometry?.toolbarCenter ?? 0);
  expect(geometry?.rightInset).toBeCloseTo(0);
  for (const target of geometry?.targets ?? []) {
    expect(target.width).toBeGreaterThanOrEqual(36);
    expect(target.height).toBe(36);
  }

  await diagram.getByRole("button", { name: "Zoom out" }).click();
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await expect(readout).not.toHaveText("100%");

  await reset.click();
  await expect(readout).toHaveText("100%");
  await expect(fit).toHaveAttribute("aria-pressed", "false");

  await fit.click();
  await expect(fit).toHaveAttribute("aria-pressed", "true");
});

test("should keep populated viewer toolbar actions reachable at narrow widths", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const toolbar = diagram.locator("[data-flow-controls]");
  const node = diagram.locator('[data-flow-node="authored"]');
  const maximize = diagram.locator("[data-figure-maximize]");

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Keep every toolbar action reachable.");
  await diagram
    .locator('.flow-diagram-compose button[data-variant="primary"]')
    .click();

  await expect(toolbar.locator(":scope > .flow-collector-add")).toBeVisible();
  await expect(maximize).toBeVisible();
  const reachability = await toolbar.evaluate((element) => {
    const toolbarRect = element.getBoundingClientRect();
    const controls = Array.from(element.querySelectorAll("button"))
      .filter((control) => control.offsetParent !== null)
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      });
    return {
      controls,
      toolbar: {
        bottom: toolbarRect.bottom,
        left: toolbarRect.left,
        right: toolbarRect.right,
        top: toolbarRect.top,
      },
      hasHorizontalOverflow: element.scrollWidth > element.clientWidth,
    };
  });
  expect(reachability.hasHorizontalOverflow).toBe(false);
  for (const control of reachability.controls) {
    expect(control.left).toBeGreaterThanOrEqual(reachability.toolbar.left);
    expect(control.right).toBeLessThanOrEqual(reachability.toolbar.right);
    expect(control.top).toBeGreaterThanOrEqual(reachability.toolbar.top);
    expect(control.bottom).toBeLessThanOrEqual(reachability.toolbar.bottom);
  }

  await maximize.click();
  await expect(diagram).toHaveAttribute("data-figure-maximized", "");
});

test("should preserve a panned canvas when feedback repaints it", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const viewport = diagram.locator("[data-flow-viewport]");
  const sizer = diagram.locator("[data-flow-sizer]");
  const node = diagram.locator('[data-flow-node="authored"]');
  const initialTransform = await sizer.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );

  await viewport.hover();
  await expect(viewport).toHaveCSS("touch-action", "auto");
  const restingScroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(restingScroll);
  await expect
    .poll(() =>
      sizer.evaluate((element) => (element as HTMLElement).style.transform),
    )
    .toBe(initialTransform);

  await diagram.locator("[data-figure-maximize]").click();
  await expect(diagram).toHaveAttribute("data-figure-maximized", "");
  // Maximizing schedules fit-to-viewport on the next frame. Let that product
  // transition settle before synthesizing the user's later pan gesture.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const fittedTransform = await sizer.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  await viewport.dispatchEvent("wheel", { deltaX: 40, deltaY: 30 });
  const pannedTransform = await sizer.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  expect(pannedTransform).not.toBe(fittedTransform);

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Keep this framing.");
  await diagram
    .locator('.flow-diagram-compose button[data-variant="primary"]')
    .click();
  await expect
    .poll(() =>
      sizer.evaluate((element) => (element as HTMLElement).style.transform),
    )
    .toBe(pannedTransform);

  const unlabeledEdge = diagram.locator(
    '[data-flow-edge-from="generator"][data-flow-edge-to="cli"]',
  );
  // Revert appears only once there is something to revert, and its hint names
  // the outcome for the state the element is actually in.
  await unlabeledEdge.click();
  const revertAction = diagram.locator('[data-flow-action="revert"]');
  await expect(revertAction).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(revertAction).toHaveText("Revert");
  await expect(revertAction).toHaveAttribute(
    "data-tooltip",
    "Restore this edge",
  );
  await page.keyboard.press("Delete");
  await expect(revertAction).toHaveCount(0);
});

test("should preserve diagram drafts when undoing review text", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const total = diagram.locator(".flow-collector-add").first();
  const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Saved diagram note");
  await diagram
    .locator(".flow-diagram-compose")
    .getByRole("button", { name: "Comment", exact: true })
    .click();
  await expect(total).toHaveText("Add 1 note to plan feedback");

  await test.step("use native undo in the diagram composer", async () => {
    await node.click();
    await diagram.locator('[data-flow-action="comment"]').click();
    const input = diagram.locator(".flow-diagram-compose textarea");
    await input.fill("Composer text");
    await page.keyboard.type("!");
    await expect(input).toHaveValue("Composer text!");
    await page.keyboard.press(undoShortcut);
    await expect(input).toHaveValue("Composer text");
    await expect(total).toHaveText("Add 1 note to plan feedback");
  });

  await test.step("use native undo in the page review composer", async () => {
    const slide = page.locator("[data-slide]").first();
    await slide.getByRole("button", { name: "Comment on slide" }).click();
    const composer = page.getByRole("dialog", { name: /Comment on/ });
    const input = composer.getByLabel("Add a comment");
    await input.fill("Page review text");
    await page.keyboard.type("!");
    await expect(input).toHaveValue("Page review text!");
    await page.keyboard.press(undoShortcut);
    await expect(input).toHaveValue("Page review text");
    await expect(total).toHaveText("Add 1 note to plan feedback");
  });
});

test("should size a persisted-collapsed diagram when expanded", async ({
  page,
  slideCraftViewerUrl,
}) => {
  await page.goto(slideCraftViewerUrl);

  const host = page.locator(
    '[data-collapsible="slide"][data-collapse-id="the-indexing-pipeline"]',
  );
  const diagram = host.locator("[data-flow-diagram]");
  const viewport = diagram.locator("[data-flow-viewport]");
  const sizer = diagram.locator("[data-flow-sizer]");
  const toggle = host.locator(
    ":scope > [data-collapse-header] > [data-collapse-toggle]",
  );
  const node = diagram.locator('[data-flow-element="node"]').first();
  const compose = diagram.locator(".flow-diagram-compose");

  await toggle.click();
  await expect(host).toHaveAttribute("data-collapsed", "");
  await page.reload();
  await expect(host).toHaveAttribute("data-collapsed", "");
  await expect(viewport).toBeHidden();
  expect(
    await viewport.evaluate((element) => (element as HTMLElement).style.height),
  ).toBe("");

  await toggle.click();
  await expect(host).not.toHaveAttribute("data-collapsed", "");
  await expect(viewport).toBeVisible();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => (element as HTMLElement).getBoundingClientRect().height,
      ),
    )
    .toBeGreaterThanOrEqual(140);
  await expect
    .poll(() =>
      sizer.evaluate((element) => (element as HTMLElement).style.transform),
    )
    .toContain("scale(");

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await compose.locator("textarea").fill("Preserve this collapsed note.");
  await toggle.click();
  await expect(compose).toBeHidden();
  await toggle.click();
  await expect(diagram.locator(".flow-collector-add").first()).toHaveText(
    "Add 1 note to plan feedback",
  );
});

test("should reach footer review actions with the mouse", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const footer = diagram.locator("[data-flow-diagram-footer]");
  const footerField = footer.locator('[data-flow-field="footer"]');
  const exitAlert = diagram.getByRole("alertdialog");

  await diagram.locator("[data-figure-maximize]").focus();
  await page.keyboard.press("Enter");
  await footer.click();
  await expect(footer).toHaveAttribute("data-flow-selected", "");
  await expect(diagram.locator('[data-flow-action="comment"]')).toBeVisible();
  await diagram.locator('[data-flow-action="comment"]').click();
  await expect(diagram.locator(".flow-diagram-compose")).toBeVisible();
  await diagram.getByRole("button", { name: "Cancel", exact: true }).click();

  await footerField.dblclick();
  await expect(footerField).toHaveAttribute("data-flow-editing", "");
  await footerField.fill("One reviewed footer");
  await diagram.locator("[data-figure-maximize]").click();
  await expect(exitAlert).toContainText(
    "You still have 1 feedback note to submit.",
  );
  await expect(
    exitAlert.getByRole("button", { name: "Go back", exact: true }),
  ).toBeVisible();
  await expect(
    exitAlert.getByRole("button", { name: "Exit full screen", exact: true }),
  ).toBeVisible();
});

test("should exit without an alert after handing off the last note", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.addInitScript(() => {
    const batches: Array<unknown> = [];
    Object.assign(window, {
      bigPlan: {
        feedback: {
          add: (batch: unknown) => batches.push(batch),
        },
      },
    });
  });
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const compose = diagram.locator(".flow-diagram-compose");
  const exitAlert = diagram.getByRole("alertdialog");
  const maximize = diagram.locator("[data-figure-maximize]");
  const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
  const toolbarAdd = diagram
    .locator("[data-flow-controls]")
    .locator(":scope > .flow-collector-add");

  await maximize.focus();
  await page.keyboard.press("Enter");
  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await compose.locator("textarea").fill("One open note");
  await page.keyboard.press("Escape");
  await expect(exitAlert).toContainText(
    "You still have 1 feedback note to submit.",
  );
  await expect(compose.locator("textarea")).toHaveValue("One open note");
  await exitAlert.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(compose.locator("textarea")).toHaveValue("One open note");

  await compose.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(toolbarAdd).toHaveText("Add 1 note to plan feedback");
  await toolbarAdd.click();
  await expect(toolbarAdd).toBeHidden();
  await expect(diagram.locator("[data-flow-selected]")).toHaveCount(0);
  await page.keyboard.press(undoShortcut);
  await expect(toolbarAdd).toBeHidden();

  await maximize.click();
  await expect(diagram).not.toHaveAttribute("data-figure-maximized");
  await expect(exitAlert).toBeHidden();
});

test("should undo the latest remaining diagram after handoff", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      bigPlan: {
        feedback: {
          add: () => undefined,
        },
      },
    });
  });
  await page.goto(flowDiagramViewerUrl);

  const firstDiagram = page.locator("[data-flow-diagram]").first();
  const secondDiagram = page.locator("[data-flow-diagram]").nth(1);
  const firstNode = firstDiagram.locator('[data-flow-node="authored"]');
  const secondNode = secondDiagram.locator('[data-flow-node="skill"]');
  const firstAdd = firstDiagram
    .locator("[data-flow-controls]")
    .locator(":scope > .flow-collector-add");
  const secondAdd = secondDiagram
    .locator("[data-flow-controls]")
    .locator(":scope > .flow-collector-add");
  const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
  const saveComment = async ({
    diagram,
    node,
    body,
  }: {
    diagram: typeof firstDiagram;
    node: typeof firstNode;
    body: string;
  }) => {
    await node.click();
    await diagram.locator('[data-flow-action="comment"]').click();
    const compose = diagram.locator(".flow-diagram-compose");
    await compose.locator("textarea").fill(body);
    await compose.getByRole("button", { name: "Comment", exact: true }).click();
  };

  await saveComment({
    diagram: firstDiagram,
    node: firstNode,
    body: "First diagram note",
  });
  await saveComment({
    diagram: secondDiagram,
    node: secondNode,
    body: "Second diagram note",
  });
  await saveComment({
    diagram: firstDiagram,
    node: firstNode,
    body: "Another first diagram note",
  });

  await firstAdd.click();
  await expect(firstAdd).toBeHidden();
  await expect(secondAdd).toBeVisible();

  await page.keyboard.press(undoShortcut);
  await expect(firstAdd).toBeHidden();
  await expect(secondAdd).toBeHidden();
});

test("should keep review chrome stable through zoom and maximize in both themes", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const footer = diagram.locator("[data-flow-diagram-footer]");
  const viewport = diagram.locator("[data-flow-viewport]");
  const toolbar = diagram.locator("[data-flow-controls]");
  const toolbarAdd = toolbar.locator(":scope > .flow-collector-add");
  const trayAdd = diagram.locator(".flow-collector-foot > .flow-collector-add");
  const exitAlert = diagram.getByRole("alertdialog");
  const compose = diagram.locator(".flow-diagram-compose");
  const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";

  await test.step("render no empty handoff controls or whole-diagram comment action", async () => {
    await expect(toolbarAdd).toBeHidden();
    await expect(toolbarAdd).toHaveText("");
    await expect(toolbarAdd).toHaveAttribute("hidden", "");
    await expect(trayAdd).toBeHidden();
    await expect(trayAdd).toHaveText("");
    await expect(trayAdd).toHaveAttribute("hidden", "");

    await diagram.focus();
    await expect(diagram).not.toHaveAttribute("data-flow-selected");
    await expect(
      diagram.locator(
        '.flow-diagram-actionbar-button[data-flow-action="comment"]',
      ),
    ).toBeHidden();

    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).toHaveAttribute("data-figure-maximized", "");
    await expect(
      diagram.locator(
        '.flow-diagram-actionbar-button[data-flow-action="comment"]',
      ),
    ).toBeHidden();

    await node.click();
    await diagram.locator('[data-flow-action="comment"]').click();
    await expect(compose).toBeVisible();
    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");
    await expect(compose).toBeHidden();
    await expect(diagram).not.toHaveAttribute("data-flow-selected");

    await diagram.locator("[data-figure-maximize]").click();
    await page.keyboard.press("Escape");
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");
    await expect(diagram).not.toHaveAttribute("data-flow-selected");
    await expect(diagram).toHaveAttribute("data-figure-focus-quiet", "");
    await expect(diagram).toBeFocused();
    await expect(diagram.locator("[data-figure-maximize]")).not.toBeFocused();
    await expect(exitAlert).toBeHidden();
  });

  await test.step("mark two saved comments at the diagram element", async () => {
    for (const body of [
      "Keep this source explicit.",
      "Preserve the ownership label.",
    ]) {
      await node.click();
      await diagram.locator('[data-flow-action="comment"]').click();
      await diagram.locator(".flow-diagram-compose textarea").fill(body);
      await diagram
        .locator('.flow-diagram-compose button[data-variant="primary"]')
        .click();
    }

    const marker = node.locator("[data-flow-comment-marker]");
    await expect(marker).toBeVisible();
    await expect(
      marker.locator('[data-lucide="message-square"]'),
    ).toBeVisible();
    await expect(marker).toContainText("2");
  });

  await test.step("pin the inline action to the toolbar's left edge", async () => {
    // The control states the count itself, so there is no second chip beside
    // it saying the same number.
    await expect(toolbarAdd).toBeVisible();
    await expect(toolbarAdd).toHaveText("Add 2 notes to plan feedback");
    await expect(diagram.locator("[data-flow-total]")).toHaveCount(0);
    const placement = await toolbar.evaluate((element) => {
      const add = element.querySelector(":scope > .flow-collector-add");
      if (add === null) return null;
      const barRect = element.getBoundingClientRect();
      const addRect = add.getBoundingClientRect();
      const firstProductControl = Array.from(element.children).find(
        (child) => !child.hasAttribute("data-review-toolbar-host"),
      );
      return {
        first: firstProductControl === add,
        followsReviewAction: add.previousElementSibling?.hasAttribute(
          "data-review-toolbar-host",
        ),
        contained:
          addRect.left >= barRect.left && addRect.right <= barRect.right,
      };
    });
    expect(placement).not.toBeNull();
    expect(placement?.first).toBe(true);
    expect(placement?.followsReviewAction).toBe(true);
    expect(placement?.contained).toBe(true);
  });

  for (const theme of ["light", "dark"]) {
    await test.step(`${theme}: keep markers fixed, footer quiet, and Escape focus sensible`, async () => {
      await page.evaluate((value) => {
        document.documentElement.dataset["theme"] = value;
      }, theme);

      await footer.hover();
      await expect
        .poll(() =>
          footer.evaluate((element) => getComputedStyle(element).outlineStyle),
        )
        .toBe("none");

      await diagram.locator('[data-flow-zoom="fit"]').click();
      for (let index = 0; index < 2; index += 1) {
        await diagram.locator('[data-flow-zoom="out"]').click();
      }
      const smallZoomMarker = await node
        .locator("[data-flow-comment-marker]")
        .boundingBox();
      for (let index = 0; index < 4; index += 1) {
        await diagram.locator('[data-flow-zoom="in"]').click();
      }
      const largeZoomMarker = await node
        .locator("[data-flow-comment-marker]")
        .boundingBox();
      expect(smallZoomMarker).not.toBeNull();
      expect(largeZoomMarker).not.toBeNull();
      expect(largeZoomMarker?.width).toBeCloseTo(smallZoomMarker?.width ?? -1);
      expect(largeZoomMarker?.height).toBeCloseTo(
        smallZoomMarker?.height ?? -1,
      );

      await diagram.locator("[data-figure-maximize]").click();
      await expect(diagram).toHaveAttribute("data-figure-maximized", "");
      await expect(viewport).toHaveCSS("overflow", "hidden");
      await expect(viewport).toHaveCSS("padding", "0px");
      await expect(viewport).toHaveCSS("touch-action", "none");
      await expect(toolbarAdd).toBeVisible();
      await expect(trayAdd).toBeVisible();
      await expect(trayAdd).toHaveText("Add 2 notes to plan feedback");
      await expect(node.locator("[data-flow-comment-marker]")).toBeVisible();
      const tray = diagram.locator(".flow-collector");
      const head = tray.locator(".flow-collector-head");
      const list = tray.locator(".flow-collector-list");
      await expect(tray).toBeVisible();
      expect(
        await head.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ).not.toBe(
        await list.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      );

      await footer.hover();
      await expect
        .poll(() =>
          footer.evaluate((element) => getComputedStyle(element).outlineStyle),
        )
        .toBe("none");

      await page.keyboard.press("Escape");
      await expect(exitAlert).toBeVisible();
      await expect(exitAlert).toContainText(
        "You still have 2 feedback notes to submit. Are you sure you want to exit full screen mode?",
      );
      await expect(diagram).toHaveAttribute("data-figure-maximized", "");
      const stay = exitAlert.getByRole("button", {
        name: "Go back",
      });
      const exit = exitAlert.getByRole("button", {
        name: "Exit full screen",
      });
      await expect(stay).toBeFocused();
      await expect(viewport).toHaveJSProperty("inert", true);
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Control+z");
      await expect(exitAlert).toContainText(
        "You still have 2 feedback notes to submit.",
      );
      await expect(node.locator("[data-flow-comment-marker]")).toContainText(
        "2",
      );
      await page.keyboard.press("Tab");
      await expect(exit).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(stay).toBeFocused();
      await stay.click();
      await expect(exitAlert).toBeHidden();
      await expect(diagram).toHaveAttribute("data-figure-maximized", "");

      await node.click();
      await diagram.locator('[data-flow-action="comment"]').click();
      await expect(compose).toBeVisible();
      await compose.locator("textarea").fill("One unsubmitted note");
      await diagram.locator("[data-figure-maximize]").click();
      await expect(exitAlert).toBeVisible();
      await expect(exitAlert).toContainText(
        "You still have 3 feedback notes to submit.",
      );
      await exit.click();
      await expect(exitAlert).toBeHidden();
      await expect(compose).toBeHidden();
      await expect(diagram).not.toHaveAttribute("data-figure-maximized");
      await expect(diagram).not.toHaveAttribute("data-flow-selected");
      await expect(toolbarAdd).toHaveText("Add 3 notes to plan feedback");
      await expect(diagram).toHaveAttribute("data-figure-focus-quiet", "");
      await expect(diagram).toBeFocused();
      await expect(diagram.locator("[data-figure-maximize]")).not.toBeFocused();
      await page.keyboard.press(undoShortcut);
      await expect(toolbarAdd).toHaveText("Add 2 notes to plan feedback");
    });
  }

  await test.step("add the note from the viewer toolbar", async () => {
    await toolbarAdd.click();
    const status = diagram.locator(".flow-collector-status");
    await expect(status).not.toHaveAttribute("hidden", "");
    await expect(status).toHaveAttribute("data-tone", "added");
    await expect(status).toContainText("Added 2 notes");
    await expect(toolbarAdd).toBeHidden();
    await page.getByRole("button", { name: /^Feedback/u }).click();
    await expect(
      page.getByText("Diagram feedback:", { exact: true }),
    ).toHaveCount(1);
  });
});
