// Proves Wireframe's bespoke diff view renders the real prototype, the
// shared Was/Now toggle, and per-screen badges without growing a switcher
// for a single-screen change.

import { createElement } from "react";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { DIFF_LIVE_CONTROL_ATTRIBUTE } from "../_model/component-diff/contract.js";
import { compileWireframeDiff } from "./compile-diff.js";
import type { CompiledWireframe, WireframeScreen } from "./model.js";
import { WireframeDiffView } from "./view-diff.js";

const screen = ({
  id,
  name,
  text,
}: {
  readonly id: string;
  readonly name: string;
  readonly text: string;
}): WireframeScreen => ({
  id,
  name,
  device: "desktop",
  children: [{ element: "Text", text, role: "body" }],
});

const wireframe = ({
  screens,
}: {
  readonly screens: ReadonlyArray<WireframeScreen>;
}): CompiledWireframe => ({
  id: "wf",
  title: "Review queue",
  initialScreenId: screens[0]?.id ?? "",
  screens,
});

const html = (node: Root | Element | undefined): string => JSON.stringify(node);

describe("WireframeDiffView", () => {
  it("should badge an updated screen on the wireframe's own switcher", () => {
    const model = compileWireframeDiff({
      status: "changed",
      baseline: wireframe({
        screens: [
          screen({ id: "queue", name: "Queue", text: "before" }),
          screen({ id: "triage", name: "Triage", text: "unchanged" }),
        ],
      }),
      proposed: wireframe({
        screens: [
          screen({ id: "queue", name: "Queue", text: "after" }),
          screen({ id: "triage", name: "Triage", text: "unchanged" }),
        ],
      }),
      runs: [],
    });
    const rendered = html(
      reactToHast(createElement(WireframeDiffView, { model })),
    );

    expect(rendered).toContain('"data-component-diff":""');
    expect(rendered).toContain("Prototype screens");
    expect(rendered).toContain("Updated");
    expect(rendered).toContain("Queue");
    expect(rendered).toContain("Triage");
    expect(rendered).toContain("Choose Was or Now");
    // Baseline isolation holds the Was side inert; this marker is what keeps
    // its screen switcher operable, so a badge on that side can be opened.
    expect(rendered).toContain(`"${DIFF_LIVE_CONTROL_ATTRIBUTE}":""`);
  });

  it("should omit the switcher when both sides have only one screen", () => {
    const model = compileWireframeDiff({
      status: "changed",
      baseline: wireframe({
        screens: [screen({ id: "only", name: "Only", text: "before" })],
      }),
      proposed: wireframe({
        screens: [screen({ id: "only", name: "Only", text: "after" })],
      }),
      runs: [],
    });
    const rendered = html(
      reactToHast(createElement(WireframeDiffView, { model })),
    );

    expect(rendered).not.toContain("Prototype screens");
    expect(rendered).toContain("Only");
  });
});
