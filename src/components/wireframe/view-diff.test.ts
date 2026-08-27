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

const elementsWithin = (node: Root | Element | undefined): Array<Element> => {
  if (node === undefined) return [];
  const found: Array<Element> = node.type === "element" ? [node] : [];
  for (const child of node.children) {
    if (child.type === "element") {
      found.push(...elementsWithin(child));
    }
  }
  return found;
};

const switcherEntriesFor = (
  node: Root | Element | undefined,
  screenId: string,
): Array<Element> =>
  elementsWithin(node).filter(
    (candidate) => candidate.properties["data-wireframe-navigate"] === screenId,
  );

const textWithin = (node: Element): string =>
  node.children
    .map((child) =>
      child.type === "text"
        ? child.value
        : child.type === "element"
          ? textWithin(child)
          : "",
    )
    .join(" ");

const formIdentityOf = (node: Root | Element | undefined): Array<string> =>
  elementsWithin(node)
    .flatMap((candidate) => [
      candidate.properties.id,
      candidate.properties.htmlFor,
      candidate.properties.name,
    ])
    .filter((value): value is string => typeof value === "string");

const changedQueue = () =>
  compileWireframeDiff({
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

describe("WireframeDiffView", () => {
  it("should badge an updated screen on the wireframe's own switcher", () => {
    const root = reactToHast(
      createElement(WireframeDiffView, {
        model: changedQueue(),
        controlId: "component-diff-queue",
      }),
    );
    const rendered = html(root);

    expect(rendered).toContain('"data-component-diff":""');
    expect(rendered).toContain("Prototype screens");
    expect(rendered).toContain("Choose Was or Now");
    // The badge names one screen, so it has to ride that screen's own
    // switcher entry: a badge drawn on the unchanged entry, or beside the
    // switcher, describes a change the reader cannot locate.
    const queue = switcherEntriesFor(root, "queue");
    const triage = switcherEntriesFor(root, "triage");
    expect(queue).toHaveLength(2);
    expect(triage).toHaveLength(2);
    for (const entry of queue) {
      expect(textWithin(entry)).toContain("Queue");
      expect(textWithin(entry)).toContain("Updated");
      // Baseline isolation holds the Was side inert; this marker is what
      // keeps its screen switcher operable, so a badge on that side can be
      // opened.
      expect(entry.properties[DIFF_LIVE_CONTROL_ATTRIBUTE]).toBe("");
    }
    for (const entry of triage) {
      expect(textWithin(entry)).toContain("Triage");
      expect(textWithin(entry)).not.toContain("Updated");
      expect(entry.properties[DIFF_LIVE_CONTROL_ATTRIBUTE]).toBe("");
    }
  });

  it("should take its toggle identity from the engine key, not the authored id", () => {
    // Two wireframes may carry the same authored id, and the engine resolves
    // them by block address. Form identity minted from the model would merge
    // their radio groups: choosing Was in one would drive the other.
    const first = formIdentityOf(
      reactToHast(
        createElement(WireframeDiffView, {
          model: changedQueue(),
          controlId: "component-diff-first",
        }),
      ),
    );
    const second = formIdentityOf(
      reactToHast(
        createElement(WireframeDiffView, {
          model: changedQueue(),
          controlId: "component-diff-second",
        }),
      ),
    );

    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(
      expect.arrayContaining([
        "component-diff-first",
        "component-diff-first-baseline",
        "component-diff-first-proposed",
      ]),
    );
    expect(first.some((identity) => second.includes(identity))).toBe(false);
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
      reactToHast(
        createElement(WireframeDiffView, {
          model,
          controlId: "component-diff-only",
        }),
      ),
    );

    expect(rendered).not.toContain("Prototype screens");
    expect(rendered).toContain("Only");
  });
});
