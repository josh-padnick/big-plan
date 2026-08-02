// Gives every commentable unit of a rendered plan a stable address, so a
// comment the reviewer leaves in the browser resolves to something the agent
// can find again in the plan source.
//
// It runs last, over the finished deck: each slide (or sub-slide) is a scope
// named by its heading anchor, and each block the reader can point at inside
// that scope gets `data-block-id`, `data-block-kind`, and `data-block-label`.
// Ids are structural paths rather than content hashes, so a block keeps its
// address across an edit that does not move it. Only the renderer mints ids,
// and every id is restricted to a path-safe character set, so a comment target
// can never carry an authored string into a filesystem path.
//
// Presentation-only wrappers stay outside the block tree: the walk stamps a
// scope's direct children and a component's root. A component may explicitly
// mark meaningful private targets with `data-block-anchor`; this transform
// then mints their final ids under the component root. Code figures likewise
// carry `data-block-line` so a comment can name a line range the way an
// authored Annotation does.

import type { Element, ElementContent, Root, RootContent } from "hast";

/** The document-order block descriptors one compile produced. */
export type BlockDescriptor = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
};

const isElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

// Tag-level kinds for the Markdown blocks the reviewer critiques as writing.
const KIND_BY_TAG: Readonly<Record<string, string>> = {
  p: "paragraph",
  ul: "list",
  ol: "list",
  blockquote: "quote",
  pre: "code",
  table: "table",
  dl: "list",
};

// Chrome and separators carry no authored claim, so they never become targets.
const NEVER_A_BLOCK = new Set(["hr", "br", "script", "style"]);

// The label a tray row and a chip show; long enough to recognise a paragraph,
// short enough to sit in a narrow rail.
const LABEL_LIMIT = 72;

const textOf = (node: Element): string => {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (isElement(child)) {
      // Screen-reader-only prefixes are announcement scaffolding, not content.
      const className = child.properties.className;
      const hidden = Array.isArray(className) && className.includes("sr-only");
      if (!hidden) {
        text += textOf(child);
      }
    }
  }
  return text;
};

const summarize = (text: string): string => {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= LABEL_LIMIT
    ? collapsed
    : `${collapsed.slice(0, LABEL_LIMIT - 1).trimEnd()}…`;
};

// Component names arrive in PascalCase; the block kind is their kebab form so
// every kind reads the same way whether it came from a tag or a component.
const kebabCase = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");

// Title-cases a kind for the label a component shows when it has no heading
// of its own: "quick-summary" reads back as "Quick summary".
const readableKind = (kind: string): string => {
  const words = kind.split("-").filter((word) => word.length > 0);
  const [first, ...rest] = words;
  if (first === undefined) {
    return "Block";
  }
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
};

// The one place an id segment is minted. Anything outside the allow-list
// becomes a hyphen, so no authored text can smuggle a path separator, a dot
// segment, or a URL scheme into a comment target.
const idSegment = (raw: string): string => {
  const safe = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return safe.length > 0 ? safe : "block";
};

const componentName = (node: Element): string | undefined => {
  const name = node.properties["data-component"];
  return typeof name === "string" && name.length > 0 ? name : undefined;
};

const findDescendant = ({
  node,
  match,
}: {
  readonly node: Element;
  readonly match: (candidate: Element) => boolean;
}): Element | undefined => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    if (match(child)) {
      return child;
    }
    const nested = findDescendant({ node: child, match });
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

const forEachDescendant = ({
  node,
  visit,
}: {
  readonly node: Element;
  readonly visit: (candidate: Element) => void;
}): void => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    visit(child);
    forEachDescendant({ node: child, visit });
  }
};

// A scroll container wraps a bare Markdown table; the container is the block a
// reviewer points at, because the table itself is inside a scrolling box.
const isTableScrollContainer = (node: Element): boolean =>
  node.properties["data-table-scroll-container"] !== undefined;

// A full slide's kicker repeats its own h2, so only the h2 becomes a block.
// A sub-slide's kicker *is* its h3, and stays the slide's commentable heading.
const isRedundantKicker = (node: Element): boolean =>
  node.properties["data-slide-kicker"] !== undefined && node.tagName === "p";

const kindOf = (node: Element): string | undefined => {
  const component = componentName(node);
  if (component !== undefined) {
    return kebabCase(component);
  }
  if (isTableScrollContainer(node)) {
    return "table";
  }
  if (HEADING_TAGS.has(node.tagName)) {
    return "heading";
  }
  return KIND_BY_TAG[node.tagName];
};

// A slide's numbered kicker is generated chrome, so a heading's label is the
// words the author wrote rather than "2.1.1 / The worker".
const KICKER_PREFIX = /^\d+(?:\.\d+)*\s*\/\s*/;

const labelOf = ({
  node,
  kind,
}: {
  readonly node: Element;
  readonly kind: string;
}): string => {
  if (componentName(node) !== undefined) {
    // A component names itself through its own heading when it has one, so a
    // tray row reads "Storage engine" rather than "Decision".
    const heading = findDescendant({
      node,
      match: (candidate) => HEADING_TAGS.has(candidate.tagName),
    });
    const headingText = heading === undefined ? "" : summarize(textOf(heading));
    if (headingText.length > 0) {
      return headingText;
    }
    const bodyText = summarize(textOf(node));
    return bodyText.length > 0 ? bodyText : readableKind(kind);
  }
  const text = summarize(textOf(node)).replace(KICKER_PREFIX, "");
  return text.length > 0 ? text : readableKind(kind);
};

// A code figure's rows carry the file-absolute line a reviewer would cite.
// CodeSnippet states it outright; a diff row keeps it in the gutter cell, new
// side first because that is the side a proposal is read on.
const stampCodeLines = (node: Element): void => {
  forEachDescendant({
    node,
    visit: (candidate) => {
      const snippetLine = candidate.properties["data-snippet-line"];
      if (typeof snippetLine === "string" && /^\d+$/.test(snippetLine)) {
        candidate.properties["data-block-line"] = snippetLine;
        return;
      }
      if (candidate.properties["data-diff-line"] === undefined) {
        return;
      }
      for (const side of ["new", "old"]) {
        const cell = findDescendant({
          node: candidate,
          match: (inner) => inner.properties["data-diff-number"] === side,
        });
        const value = cell === undefined ? "" : textOf(cell).trim();
        if (/^\d+$/.test(value)) {
          candidate.properties["data-block-line"] = value;
          candidate.properties["data-block-line-side"] = side;
          return;
        }
      }
    },
  });
};

// Allocates one id inside a scope, numbering repeats of a kind in document
// order so "the third paragraph of this slide" is addressable and stable.
type ScopeCounter = Map<string, number>;

const allocateId = ({
  scope,
  kind,
  counter,
}: {
  readonly scope: string;
  readonly kind: string;
  readonly counter: ScopeCounter;
}): string => {
  const next = (counter.get(kind) ?? 0) + 1;
  counter.set(kind, next);
  return `${scope}/${idSegment(kind)}-${next}`;
};

// A Markdown table is one readable figure, but repeated rows are the units a
// reviewer most often distinguishes in feedback. The row label comes from
// its first authored cell ("versionId", "number", ...), which is concrete
// enough for two adjacent rows to remain scannable in the comments tray.
const stampTableRows = ({
  table,
  scope,
  section,
  blocks,
  counter,
}: {
  readonly table: Element;
  readonly scope: string;
  readonly section: string;
  readonly blocks: Array<BlockDescriptor>;
  readonly counter: ScopeCounter;
}): void => {
  forEachDescendant({
    node: table,
    visit: (candidate) => {
      if (candidate.tagName !== "tr") {
        return;
      }
      const firstCell = candidate.children.find(
        (child): child is Element =>
          isElement(child) &&
          (child.tagName === "th" || child.tagName === "td"),
      );
      const label =
        firstCell === undefined ? "Table row" : summarize(textOf(firstCell));
      const id = allocateId({ scope, kind: "table-row", counter });
      candidate.properties["data-block-id"] = id;
      candidate.properties["data-block-kind"] = "table-row";
      candidate.properties["data-block-label"] =
        label.length > 0 ? label : "Table row";
      candidate.properties["data-block-section"] = section;
      blocks.push({
        id,
        kind: "table-row",
        label: label.length > 0 ? label : "Table row",
        section,
      });
    },
  });
};

// Component views mark only elements that are meaningful review targets. The
// marker is an anchor, never a final id: this renderer remains the one owner
// that namespaces and registers every address accepted by the review runtime.
const stampComponentTargets = ({
  component,
  componentId,
  section,
  blocks,
}: {
  readonly component: Element;
  readonly componentId: string;
  readonly section: string;
  readonly blocks: Array<BlockDescriptor>;
}): void => {
  const ids = new Set<string>();
  forEachDescendant({
    node: component,
    visit: (candidate) => {
      const anchor = candidate.properties["data-block-anchor"];
      if (typeof anchor !== "string" || anchor.length === 0) {
        return;
      }
      const kindValue = candidate.properties["data-block-kind"];
      const labelValue = candidate.properties["data-block-label"];
      const kind =
        typeof kindValue === "string" && kindValue.length > 0
          ? idSegment(kindValue)
          : "component-element";
      const label =
        typeof labelValue === "string" && labelValue.length > 0
          ? summarize(labelValue)
          : readableKind(kind);
      const baseId = `${componentId}/${idSegment(anchor)}`;
      let id = baseId;
      let suffix = 2;
      while (ids.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      ids.add(id);
      delete candidate.properties["data-block-anchor"];
      candidate.properties["data-block-id"] = id;
      candidate.properties["data-block-kind"] = kind;
      candidate.properties["data-block-label"] = label;
      candidate.properties["data-block-section"] = section;
      blocks.push({ id, kind, label, section });
    },
  });
};

// A container this walk is not allowed to enter: it belongs to a scope of its
// own and will be visited as one.
const isNestedScope = (node: Element): boolean =>
  node.properties["data-slide"] !== undefined ||
  node.properties["data-subpart"] !== undefined;

// Walks one scope in document order, stamping the first block-bearing element
// on each branch. An element the walk cannot name - a layout div the deck or a
// later feature wraps content in - is presentation, so the walk descends
// through it rather than losing the blocks underneath. A component's root is
// nameable, so the walk stops there and its internals stay private.
const stampScope = ({
  container,
  scope,
  section,
  blocks,
  counter = new Map(),
}: {
  readonly container: Element | Root;
  readonly scope: string;
  readonly section: string;
  readonly blocks: Array<BlockDescriptor>;
  readonly counter?: ScopeCounter;
}): void => {
  for (const child of container.children) {
    if (!isElement(child) || NEVER_A_BLOCK.has(child.tagName)) {
      continue;
    }
    if (isRedundantKicker(child) || isNestedScope(child)) {
      continue;
    }
    const kind = kindOf(child);
    if (kind === undefined) {
      stampScope({ container: child, scope, section, blocks, counter });
      continue;
    }
    const label = labelOf({ node: child, kind });
    const id = allocateId({ scope, kind, counter });
    child.properties["data-block-id"] = id;
    child.properties["data-block-kind"] = kind;
    child.properties["data-block-label"] = label;
    child.properties["data-block-section"] = section;
    blocks.push({ id, kind, label, section });
    if (componentName(child) !== undefined) {
      stampComponentTargets({
        component: child,
        componentId: id,
        section,
        blocks,
      });
    }
    if (kind === "code" || kind.startsWith("code-")) {
      stampCodeLines(child);
    } else if (kind === "table") {
      stampTableRows({ table: child, scope, section, blocks, counter });
    }
  }
};

// The scope a slide contributes: its heading's anchor, so a block id reads as
// a path a human can follow ("section/status-quo/paragraph-2").
const scopeNameFor = ({
  node,
  headingTag,
  fallback,
}: {
  readonly node: Element;
  readonly headingTag: string;
  readonly fallback: string;
}): string => {
  const heading = findDescendant({
    node,
    match: (candidate) =>
      candidate.tagName === headingTag &&
      typeof candidate.properties.id === "string",
  });
  const id = heading?.properties.id;
  return typeof id === "string" ? `section/${idSegment(id)}` : fallback;
};

/**
 * Creates the rehype transform that stamps block identity across a finished
 * deck and reports the descriptors it minted.
 */
export const rehypeBlockIdentity =
  ({ blocks }: { readonly blocks?: Array<BlockDescriptor> } = {}) =>
  (tree: Root): void => {
    const collected: Array<BlockDescriptor> = [];
    // Everything above the first slide - the title, lede, summary card, and
    // contents - shares the document's own scope.
    const intro: Root = {
      type: "root",
      children: tree.children.filter(
        (child) =>
          isElement(child) &&
          child.properties["data-slide"] === undefined &&
          child.properties["data-subpart"] === undefined,
      ),
    };
    stampScope({
      container: intro,
      scope: "document",
      section: "Overview",
      blocks: collected,
    });
    let slideIndex = 0;
    const stampDeckScope = (child: Element): void => {
      slideIndex += 1;
      const isSubSlide = child.properties["data-subslide"] !== undefined;
      const scope = scopeNameFor({
        node: child,
        headingTag: isSubSlide ? "h3" : "h2",
        fallback: `slide/${slideIndex}`,
      });
      const sectionHeading = findDescendant({
        node: child,
        match: (candidate) => candidate.tagName === (isSubSlide ? "h3" : "h2"),
      });
      const section =
        sectionHeading === undefined
          ? `Section ${slideIndex}`
          : summarize(textOf(sectionHeading)).replace(KICKER_PREFIX, "");
      stampScope({ container: child, scope, section, blocks: collected });
      // Current deck chrome nests sub-slides inside the parent collapse body.
      // They remain independent comment scopes, so walk through presentation
      // wrappers to find them after stamping (and deliberately skipping) the
      // parent scope's own private child scope.
      forEachDescendant({
        node: child,
        visit: (candidate) => {
          if (candidate.properties["data-subslide"] !== undefined) {
            stampDeckScope(candidate);
          }
        },
      });
    };
    // Part groups are presentation wrappers around their slides. Find each
    // outer slide through those wrappers instead of assuming slides remain
    // direct root children after the deck transforms finish. A parent slide
    // owns discovery of its own sub-slides, so the outer walk stops at it.
    const stampOuterSlides = (container: Element | Root): void => {
      for (const child of container.children) {
        if (!isElement(child)) {
          continue;
        }
        if (child.properties["data-slide"] !== undefined) {
          if (child.properties["data-subslide"] === undefined) {
            stampDeckScope(child);
          }
          continue;
        }
        stampOuterSlides(child);
      }
    };
    stampOuterSlides(tree);
    blocks?.push(...collected);
  };
