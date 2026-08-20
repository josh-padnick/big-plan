import { describe, expect, it } from "vitest";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { compileMarkdown } from "./compile-markdown.js";
import { rehypeBlockIdentity, type BlockDescriptor } from "./block-identity.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
  TRIGGER_ATTRIBUTE,
} from "../../components/_model/figure-controls/figure-controls.js";
import {
  DIFF_BASELINE_SIDE,
  DIFF_SIDE_ATTRIBUTE,
  isolateBaselineSide,
  isBaselineDiffSide,
} from "./side-isolation.js";

const BOTH_SIDES_FIXTURE = `## Calls

<Decision question="Which store?">

Context for the call.

<Option title="SQLite" recommended summary="Zero setup for local review.">

<Consideration label="Setup" verdict="None" tone="good" />

</Option>

<Option title="Postgres" summary="A server the reviewer must run.">

<Consideration label="Setup" verdict="A server" tone="bad" />

</Option>

</Decision>

<DataTable title="Queue depth by processor">

\`\`\`table
| Processor | Attempts |
| --- | ---: |
| Stripe | 3 |
\`\`\`

</DataTable>
`;

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

const forEachElement = ({
  node,
  visit,
  skipBaseline = false,
}: {
  readonly node: Root | Element;
  readonly visit: (candidate: Element) => void;
  readonly skipBaseline?: boolean;
}): void => {
  if (node.type === "root") {
    for (const child of node.children) {
      if (isElement(child)) {
        forEachElement({ node: child, visit, skipBaseline });
      }
    }
    return;
  }
  if (skipBaseline && isBaselineDiffSide(node)) {
    return;
  }
  visit(node);
  for (const child of node.children) {
    if (isElement(child)) {
      forEachElement({ node: child, visit, skipBaseline });
    }
  }
};

const htmlForTargets = (node: Element): ReadonlyArray<string> => {
  const value = node.properties.htmlFor;
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  return [];
};

const collect = ({
  node,
  match,
  skipBaseline = false,
}: {
  readonly node: Root | Element;
  readonly match: (candidate: Element) => boolean;
  readonly skipBaseline?: boolean;
}): Array<Element> => {
  const found: Array<Element> = [];
  forEachElement({
    node,
    skipBaseline,
    visit: (candidate) => {
      if (match(candidate)) {
        found.push(candidate);
      }
    },
  });
  return found;
};

const ordinaryIdsOf = (
  node: Root | Element,
  { skipBaseline = false }: { readonly skipBaseline?: boolean } = {},
): Array<string> => {
  const ids: Array<string> = [];
  forEachElement({
    node,
    skipBaseline,
    visit: (candidate) => {
      if (typeof candidate.properties.id === "string") {
        ids.push(candidate.properties.id);
      }
    },
  });
  return ids;
};

const referencedIdentifiers = (value: string): Array<string> => {
  const found: Array<string> = [];
  for (const match of value.matchAll(
    /url\(#([^)]+)\)|#([A-Za-z][A-Za-z0-9_:-]*)/gu,
  )) {
    const identifier = match[1] ?? match[2];
    if (identifier !== undefined) {
      found.push(identifier);
    }
  }
  if (found.length > 0) {
    return found;
  }
  return value.split(/\s+/u).filter((token) => token.length > 0);
};

const referencesOf = (node: Element): Array<string> => {
  const references: Array<string> = [];
  const consider = (value: string, property: string): void => {
    if (property === "id" || property === "className") {
      return;
    }
    if (
      property === "htmlFor" ||
      property === "for" ||
      property.startsWith("aria-")
    ) {
      references.push(...referencedIdentifiers(value));
      return;
    }
    if (value.includes("#")) {
      references.push(...referencedIdentifiers(value));
    }
  };
  forEachElement({
    node,
    visit: (candidate) => {
      for (const [property, value] of Object.entries(candidate.properties)) {
        if (typeof value === "string") {
          consider(value, property);
        } else if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === "string") {
              consider(entry, property);
            }
          }
        }
      }
      if (candidate.tagName !== "style") {
        return;
      }
      for (const child of candidate.children) {
        if (child.type === "text") {
          consider(child.value, "style");
        }
      }
    },
  });
  return references;
};

const nestedBaselineCopy = (root: Element): Element => {
  const clone = structuredClone(root);
  isolateBaselineSide({ subtree: clone });
  root.children = [clone, ...root.children];
  return clone;
};

const documentWithBothSides = () => {
  const compiled = compileMarkdown({ markdown: BOTH_SIDES_FIXTURE });
  const decision = collect({
    node: compiled.root,
    match: (candidate) => candidate.properties["data-component"] === "Decision",
  })[0];
  const table = collect({
    node: compiled.root,
    match: (candidate) =>
      candidate.properties["data-component"] === "DataTable",
  })[0];
  if (decision === undefined || table === undefined) {
    throw new Error("expected a Decision and a DataTable");
  }
  return {
    root: compiled.root,
    blocks: compiled.blocks,
    decision,
    table,
    baselineDecision: nestedBaselineCopy(decision),
    baselineTable: nestedBaselineCopy(table),
  };
};

describe("side isolation", () => {
  it("should mark the subtree as the baseline side", () => {
    const subtree: Element = {
      type: "element",
      tagName: "div",
      properties: { id: "panel" },
      children: [],
    };
    isolateBaselineSide({ subtree });
    expect(isBaselineDiffSide(subtree)).toBe(true);
    expect(subtree.properties[DIFF_SIDE_ATTRIBUTE]).toBe(DIFF_BASELINE_SIDE);
  });

  it("should leave no duplicate ordinary id when a Decision and a DataTable render on both sides", () => {
    const { root } = documentWithBothSides();
    const ids = ordinaryIdsOf(root);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should rewrite htmlFor, ARIA, and SVG references to resolve within their own side", () => {
    const { decision, baselineDecision } = documentWithBothSides();
    const proposedIds = new Set(
      ordinaryIdsOf(decision, { skipBaseline: true }),
    );
    const baselineIds = new Set(ordinaryIdsOf(baselineDecision));
    const proposedHtmlFor = collect({
      node: decision,
      skipBaseline: true,
      match: (candidate) => htmlForTargets(candidate).length > 0,
    });
    const baselineHtmlFor = collect({
      node: baselineDecision,
      match: (candidate) => htmlForTargets(candidate).length > 0,
    });
    expect(proposedHtmlFor.length).toBeGreaterThan(0);
    expect(baselineHtmlFor.length).toBeGreaterThan(0);
    for (const label of proposedHtmlFor) {
      for (const target of htmlForTargets(label)) {
        expect(proposedIds.has(target)).toBe(true);
        expect(baselineIds.has(target)).toBe(false);
      }
    }
    for (const label of baselineHtmlFor) {
      for (const target of htmlForTargets(label)) {
        expect(baselineIds.has(target)).toBe(true);
        expect(proposedIds.has(target)).toBe(false);
      }
    }

    const clip: Element = {
      type: "element",
      tagName: "clipPath",
      properties: { id: "clip" },
      children: [],
    };
    const svg: Element = {
      type: "element",
      tagName: "svg",
      properties: {},
      children: [
        clip,
        {
          type: "element",
          tagName: "rect",
          properties: {
            "clip-path": "url(#clip)",
            href: "#clip",
            "aria-labelledby": "title caption",
          },
          children: [],
        },
        {
          type: "element",
          tagName: "title",
          properties: { id: "title" },
          children: [{ type: "text", value: "Title" }],
        },
        {
          type: "element",
          tagName: "desc",
          properties: { id: "caption" },
          children: [{ type: "text", value: "Caption" }],
        },
      ],
    };
    isolateBaselineSide({ subtree: svg });
    const svgIds = new Set(ordinaryIdsOf(svg));
    for (const reference of referencesOf(svg)) {
      expect(svgIds.has(reference)).toBe(true);
    }
    expect(svgIds.has("clip")).toBe(false);
    expect([...svgIds].every((id) => id.startsWith("diff-baseline-"))).toBe(
      true,
    );
  });

  it("should keep the baseline mark when a descendant id is the word baseline", () => {
    const subtree: Element = {
      type: "element",
      tagName: "div",
      properties: { id: "panel" },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { id: "baseline", alt: "panel", title: "panel" },
          children: [],
        },
      ],
    };
    isolateBaselineSide({ subtree });
    expect(isBaselineDiffSide(subtree)).toBe(true);
    expect(subtree.properties[DIFF_SIDE_ATTRIBUTE]).toBe(DIFF_BASELINE_SIDE);
    expect(ordinaryIdsOf(subtree)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^diff-baseline-[a-z0-9]+-panel$/u),
        expect.stringMatching(/^diff-baseline-[a-z0-9]+-baseline$/u),
      ]),
    );
    const labelled: Element = {
      type: "element",
      tagName: "span",
      properties: { id: "baseline" },
      children: [],
    };
    const marked: Element = {
      type: "element",
      tagName: "div",
      properties: {},
      children: [
        labelled,
        {
          type: "element",
          tagName: "p",
          properties: {
            "aria-labelledby": "baseline external-note",
            alt: "baseline",
          },
          children: [],
        },
      ],
    };
    isolateBaselineSide({ subtree: marked });
    const prefixed = ordinaryIdsOf(marked)[0];
    expect(typeof prefixed).toBe("string");
    expect(marked.children[1]).toMatchObject({
      type: "element",
      properties: {
        "aria-labelledby": `${prefixed} external-note`,
        alt: "baseline",
      },
    });
  });

  it("should keep one live maximize trigger when a DataTable renders on both sides", () => {
    const { table, baselineTable } = documentWithBothSides();
    const liveFrames = collect({
      node: table,
      match: (candidate) =>
        candidate.properties[MAXIMIZABLE_ATTRIBUTE] !== undefined,
    });
    const liveBodies = collect({
      node: table,
      match: (candidate) => candidate.properties[BODY_ATTRIBUTE] !== undefined,
    });
    expect(liveFrames).toHaveLength(1);
    expect(liveBodies).toHaveLength(1);
    expect(
      collect({
        node: table,
        skipBaseline: true,
        match: (candidate) =>
          candidate.properties[TRIGGER_ATTRIBUTE] !== undefined,
      }),
    ).toHaveLength(1);
    expect(
      collect({
        node: baselineTable,
        match: (candidate) =>
          candidate.properties[TRIGGER_ATTRIBUTE] !== undefined,
      }),
    ).toHaveLength(0);
    const inertButtons = collect({
      node: baselineTable,
      match: (candidate) =>
        candidate.tagName === "button" && candidate.properties.inert === true,
    });
    expect(inertButtons.length).toBeGreaterThan(0);
  });

  it("should give two identical baseline subtrees different ordinary ids", () => {
    const copy = (): Element => ({
      type: "element",
      tagName: "label",
      properties: { id: "choice", htmlFor: "choice" },
      children: [],
    });
    const first = copy();
    const second = copy();
    isolateBaselineSide({ subtree: first, key: "was-a" });
    isolateBaselineSide({ subtree: second, key: "was-b" });
    const firstId = ordinaryIdsOf(first)[0];
    const secondId = ordinaryIdsOf(second)[0];
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
    expect(htmlForTargets(first)).toEqual([firstId]);
    expect(htmlForTargets(second)).toEqual([secondId]);
  });

  it("should mint the same proposed-side block ids as the same document without a baseline side", () => {
    const withoutBaseline = compileMarkdown({ markdown: BOTH_SIDES_FIXTURE });
    const { root } = documentWithBothSides();
    const blocks: Array<BlockDescriptor> = [];
    rehypeBlockIdentity({ blocks })(root);
    expect(blocks.map((block) => block.id)).toEqual(
      withoutBaseline.blocks.map((block) => block.id),
    );
    expect(
      collect({
        node: root,
        match: (candidate) =>
          isBaselineDiffSide(candidate) &&
          candidate.properties["data-block-id"] !== undefined,
      }),
    ).toHaveLength(0);
  });
});
