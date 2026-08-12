// Enforces the collapse structure invariants documented in deck-collapse.ts
// against real compiled documents, at every deck level and in combination.
//
// These are regression guards with history: the deck once shipped with slide
// bodies nested inside the element the viewer script used as its click
// target. That made body text a collapse button and made a sub-slide's click
// bubble into its parent group, because the invariant lived only in a prose
// comment that a later layout fix silently invalidated. Each test below fails
// loudly if that shape returns.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile-markdown.js";
import type { Element, ElementContent, Root, RootContent } from "hast";
import {
  COLLAPSE_BODY_ATTRIBUTE,
  COLLAPSE_HEADER_ATTRIBUTE,
  COLLAPSE_NAME_ATTRIBUTE,
  COLLAPSE_TOGGLE_ATTRIBUTE,
  COLLAPSIBLE_ATTRIBUTE,
} from "./deck-collapse.js";

const NESTED_FIXTURE = `# Deck plan

The lede.

<Part title="Context" />

## Status quo

*What is true today.*

Today's state.

## Implementation

*How it lands.*

An intro line.

### Pipeline

How it travels.

### Change list

What moves.
`;

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

const parse = (markdown: string): Root => compileMarkdown({ markdown }).root;

const collect = (
  node: Root | Element,
  predicate: (element: Element) => boolean,
): ReadonlyArray<Element> => {
  const found: Array<Element> = [];
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (predicate(child)) found.push(child);
    found.push(...collect(child, predicate));
  }
  return found;
};

const has = (element: Element, attribute: string): boolean =>
  element.properties[attribute] !== undefined;

const collapsibles = (tree: Root): ReadonlyArray<Element> =>
  collect(tree, (element) => has(element, COLLAPSIBLE_ATTRIBUTE));

const headerOf = (block: Element): Element | undefined =>
  block.children
    .filter(isElement)
    .find((child) => has(child, COLLAPSE_HEADER_ATTRIBUTE));

describe("collapse structure contract", () => {
  it("should give every collapsible exactly one header holding the toggle", () => {
    const tree = parse(NESTED_FIXTURE);
    const blocks = collapsibles(tree);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const headers = block.children
        .filter(isElement)
        .filter((child) => has(child, COLLAPSE_HEADER_ATTRIBUTE));
      expect(headers).toHaveLength(1);
      const [header] = headers;
      const toggles = (header?.children ?? [])
        .filter(isElement)
        .filter((child) => has(child, COLLAPSE_TOGGLE_ATTRIBUTE));
      expect(toggles).toHaveLength(1);
    }
  });

  it("should keep the body a sibling of the header, never inside it", () => {
    const tree = parse(NESTED_FIXTURE);
    for (const block of collapsibles(tree)) {
      const header = headerOf(block);
      expect(header).toBeDefined();
      // Invariant 1: a body anywhere under the hit target would make body
      // content clickable and collapse the region on an ordinary click.
      expect(
        collect(header as Element, (element) =>
          has(element, COLLAPSE_BODY_ATTRIBUTE),
        ),
      ).toHaveLength(0);
      const bodies = block.children
        .filter(isElement)
        .filter((child) => has(child, COLLAPSE_BODY_ATTRIBUTE));
      expect(bodies.length).toBeLessThanOrEqual(1);
    }
  });

  it("should nest a collapsible only inside an ancestor body, never a header", () => {
    const tree = parse(NESTED_FIXTURE);
    for (const block of collapsibles(tree)) {
      const header = headerOf(block);
      // Invariant 2: a nested region inside the hit target would bubble its
      // click into this ancestor and toggle both at once.
      expect(
        collect(header as Element, (element) =>
          has(element, COLLAPSIBLE_ATTRIBUTE),
        ),
      ).toHaveLength(0);
    }
  });

  it("should mark exactly one name in every slide and sub-slide header", () => {
    const tree = parse(NESTED_FIXTURE);
    // Invariant 4. A sub-slide once lost this because its name is the kicker
    // rather than a separate title, so a hit target keyed on the slide-level
    // title class silently stopped matching it.
    const named = collapsibles(tree).filter((block) => {
      const kind = block.properties[COLLAPSIBLE_ATTRIBUTE];
      return kind === "slide" || kind === "subslide";
    });
    expect(named.length).toBeGreaterThan(1);
    for (const block of named) {
      const header = headerOf(block);
      expect(header).toBeDefined();
      expect(
        collect(header as Element, (element) =>
          has(element, COLLAPSE_NAME_ATTRIBUTE),
        ),
      ).toHaveLength(1);
    }
  });

  it("should place sub-slides in the group body so both levels toggle independently", () => {
    const tree = parse(NESTED_FIXTURE);
    const group = collapsibles(tree).find(
      (block) =>
        collect(
          block,
          (element) => element.properties[COLLAPSIBLE_ATTRIBUTE] === "subslide",
        ).length > 0,
    );
    expect(group).toBeDefined();
    const body = (group as Element).children
      .filter(isElement)
      .find((child) => has(child, COLLAPSE_BODY_ATTRIBUTE));
    expect(body).toBeDefined();
    const subs = collect(
      body as Element,
      (element) => element.properties[COLLAPSIBLE_ATTRIBUTE] === "subslide",
    );
    expect(subs).toHaveLength(2);
  });

  it("should carry the part band as header chrome and its slides as body", () => {
    const tree = parse(NESTED_FIXTURE);
    const part = collapsibles(tree).find(
      (block) => block.properties[COLLAPSIBLE_ATTRIBUTE] === "part",
    );
    expect(part).toBeDefined();
    const body = (part as Element).children
      .filter(isElement)
      .find((child) => has(child, COLLAPSE_BODY_ATTRIBUTE));
    expect(
      collect(
        body as Element,
        (element) => element.properties[COLLAPSIBLE_ATTRIBUTE] === "slide",
      ).length,
    ).toBeGreaterThan(0);
  });
});
