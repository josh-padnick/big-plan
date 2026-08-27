// Proves Wireframe's bespoke diff view renders the real prototype, the
// shared Was/Now toggle, and per-screen badges without growing a switcher
// for a single-screen change.

import { createElement } from "react";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { DIFF_LIVE_ATTRIBUTE } from "../_model/component-diff/contract.js";
import { compileWireframeDiff } from "./compile-diff.js";
import type { CompiledWireframe, WireframeScreen } from "./model.js";
import { WireframeDiffView } from "./view-diff.js";

const screen = ({
  id,
  name,
  text,
  navigateTo,
}: {
  readonly id: string;
  readonly name: string;
  readonly text: string;
  readonly navigateTo?: string;
}): WireframeScreen => ({
  id,
  name,
  device: "desktop",
  children: [
    { element: "Text", text, role: "body" },
    ...(navigateTo === undefined
      ? []
      : [
          {
            element: "Button" as const,
            label: "Open triage",
            emphasis: "primary" as const,
            navigateTo,
          },
        ]),
  ],
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
    (candidate) =>
      candidate.properties["data-wireframe-switch"] !== undefined &&
      candidate.properties["data-wireframe-navigate"] === screenId,
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

const sideOf = (
  node: Root | Element | undefined,
  side: "baseline" | "proposed",
): Element | undefined =>
  elementsWithin(node).find(
    (candidate) => candidate.properties["data-component-diff-side"] === side,
  );

const classesOf = (node: Element): ReadonlyArray<string> => {
  const value = node.properties.className;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? value.split(/\s+/u) : [];
};

const prototypeButtonsOf = (node: Element | undefined): Array<Element> =>
  elementsWithin(node).filter(
    (candidate) =>
      candidate.tagName === "button" &&
      classesOf(candidate).includes("wireframe-button"),
  );

const liveScreenRegionsOf = (
  node: Root | Element | undefined,
): Array<Element> =>
  elementsWithin(node).filter(
    (candidate) =>
      candidate.properties[DIFF_LIVE_ATTRIBUTE] === "" &&
      elementsWithin(candidate).some(
        (descendant) =>
          descendant.properties["data-wireframe-screen"] !== undefined,
      ),
  );

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
      expect(entry.properties[DIFF_LIVE_ATTRIBUTE]).toBe("");
    }
    for (const entry of triage) {
      expect(textWithin(entry)).toContain("Triage");
      expect(textWithin(entry)).not.toContain("Updated");
      expect(entry.properties[DIFF_LIVE_ATTRIBUTE]).toBe("");
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

  it("should freeze the Was prototype's own controls without changing how they draw", () => {
    // A navigable Was side would leave the two prototypes on different
    // screens under one Was/Now toggle. The freeze takes the control out of
    // the tab order and the viewer script refuses its navigation, but every
    // hook a stylesheet selects on survives: the reader is comparing these
    // two renderings, so a difference the plan never proposed reads as one
    // it did.
    const withButton = () =>
      compileWireframeDiff({
        status: "changed",
        baseline: wireframe({
          screens: [
            screen({
              id: "queue",
              name: "Queue",
              text: "before",
              navigateTo: "triage",
            }),
            screen({ id: "triage", name: "Triage", text: "unchanged" }),
          ],
        }),
        proposed: wireframe({
          screens: [
            screen({
              id: "queue",
              name: "Queue",
              text: "after",
              navigateTo: "triage",
            }),
            screen({ id: "triage", name: "Triage", text: "unchanged" }),
          ],
        }),
        runs: [],
      });
    const root = reactToHast(
      createElement(WireframeDiffView, {
        model: withButton(),
        controlId: "component-diff-frozen",
      }),
    );

    const wasButtons = prototypeButtonsOf(sideOf(root, "baseline"));
    const nowButtons = prototypeButtonsOf(sideOf(root, "proposed"));
    expect(wasButtons).toHaveLength(1);
    expect(nowButtons).toHaveLength(1);
    // Three stylesheet rules select on `data-wireframe-navigate`, including
    // the phone top bar's push/dismiss layout, so dropping it on one side
    // would relayout the screen under the toggle.
    expect(wasButtons[0]?.properties["data-wireframe-navigate"]).toBe("triage");
    expect(wasButtons[0]?.properties.tabIndex).toBe(-1);
    expect(wasButtons[0]?.properties["data-wireframe-frozen"]).toBe("");
    expect(wasButtons[0]?.properties.disabled).toBeUndefined();
    expect(textWithin(wasButtons[0] as Element)).toContain("Open triage");
    expect(nowButtons[0]?.properties.tabIndex).toBeUndefined();
    expect(nowButtons[0]?.properties.disabled).toBeUndefined();
    expect(nowButtons[0]?.properties["data-wireframe-navigate"]).toBe("triage");
    // The Was switcher is the one control that stays operable, so it keeps
    // both its navigation hook and its live mark.
    const wasSwitcher = switcherEntriesFor(sideOf(root, "baseline"), "triage");
    expect(wasSwitcher).toHaveLength(1);
    expect(wasSwitcher[0]?.properties.disabled).toBeUndefined();
    expect(wasSwitcher[0]?.properties[DIFF_LIVE_ATTRIBUTE]).toBe("");
  });

  it("should freeze a Was field without borrowing the authored disabled state", () => {
    // `disabled` is a design decision the plan states, in paint and in what a
    // screen reader announces. If the freeze borrowed it, every Was field
    // would grey and announce as unavailable, and a revision that adds
    // `disabled` to a field would compare as no change at all.
    const fields = (label: string): WireframeScreen => ({
      id: "form",
      name: "Form",
      device: "desktop",
      children: [
        {
          element: "TextField",
          label: "Subject",
          kind: "text",
          disabled: false,
        },
        {
          element: "TextField",
          label,
          kind: "text",
          disabled: true,
        },
      ],
    });
    const root = reactToHast(
      createElement(WireframeDiffView, {
        model: compileWireframeDiff({
          status: "changed",
          baseline: wireframe({ screens: [fields("Digest hour")] }),
          proposed: wireframe({ screens: [fields("Digest time")] }),
          runs: [],
        }),
        controlId: "component-diff-fields",
      }),
    );

    const inputsOn = (side: "baseline" | "proposed") =>
      elementsWithin(sideOf(root, side)).filter((candidate) =>
        classesOf(candidate).includes("wireframe-input"),
      );
    const was = inputsOn("baseline");
    const now = inputsOn("proposed");
    expect(was).toHaveLength(2);
    expect(now).toHaveLength(2);
    // Both Was fields are frozen and both report exactly the disabled state
    // the plan authored, so the two sides still compare on that state.
    expect(was.map((field) => field.properties.disabled)).toEqual([
      undefined,
      true,
    ]);
    expect(now.map((field) => field.properties.disabled)).toEqual([
      undefined,
      true,
    ]);
    // The freeze is carried by its own mark: out of the tab order, refusing
    // pointers through the rule that mark keys, and read-only so a reader
    // who reaches it another way still cannot edit the evidence.
    expect(
      was.map((field) => field.properties["data-wireframe-frozen"]),
    ).toEqual(["", ""]);
    expect(was.map((field) => field.properties.tabIndex)).toEqual([-1, -1]);
    expect(was.map((field) => field.properties.readOnly)).toEqual([true, true]);
    // The label forwards a click to the control it wraps, so it is marked too.
    expect(
      elementsWithin(sideOf(root, "baseline")).filter(
        (candidate) =>
          candidate.tagName === "label" &&
          candidate.properties["data-wireframe-frozen"] === "",
      ),
    ).toHaveLength(2);
    // The Now side is untouched by the freeze.
    expect(
      now.map((field) => field.properties["data-wireframe-frozen"]),
    ).toEqual([undefined, undefined]);
    expect(now.map((field) => field.properties.tabIndex)).toEqual([
      undefined,
      undefined,
    ]);
    expect(now.map((field) => field.properties.readOnly)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("should leave a wholly removed wireframe's switcher unbadged but live", () => {
    // The figcaption already says the whole component went; badging every
    // entry adds nothing and strikes through the control the reader needs to
    // read the screens that are gone.
    const root = reactToHast(
      createElement(WireframeDiffView, {
        model: compileWireframeDiff({
          status: "removed",
          baseline: wireframe({
            screens: [
              screen({ id: "queue", name: "Queue", text: "gone" }),
              screen({ id: "triage", name: "Triage", text: "also gone" }),
            ],
          }),
          runs: [],
        }),
        controlId: "component-diff-removed",
      }),
    );

    const entries = [
      ...switcherEntriesFor(root, "queue"),
      ...switcherEntriesFor(root, "triage"),
    ];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(textWithin(entry)).not.toContain("Removed from");
      expect(entry.properties[DIFF_LIVE_ATTRIBUTE]).toBe("");
    }
    expect(liveScreenRegionsOf(root)).toHaveLength(1);
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
