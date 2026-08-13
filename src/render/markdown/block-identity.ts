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
// scope's direct children and a component's root. A component may deliberately
// expose a semantic sub-target with `data-commentable-kind`; everything else
// inside it stays private. Code figures also expose `data-block-line` so a
// comment can name a line range the way an authored Annotation does.

import type { Element, ElementContent, Root, RootContent } from "hast";
import {
  CALLOUT_TYPES,
  type CalloutType,
} from "../../components/callout/compile.js";
import { COMPONENT_NAME_ATTRIBUTE } from "./component-pipeline/component-name.js";

// The meaning-bearing presentation facts a snapshot must record so a diff can
// replay a block without consulting the live document. Only a fact that
// changes what the plan asserts belongs here: a callout's type, because danger
// replayed as note misstates risk, and a list's ordering, because numbers
// replayed as bullets misstate whether sequence matters. Styling and layout
// stay out - they are reproducible presentation, and carrying them would grow
// this into a second rendering contract.
// Mirrored by hand across the reviewShared tier boundary; reviewShared may
// import nothing - keep this in sync with src/review/shared/review-wire.ts.
export type BlockPresentation =
  | { readonly aspect: "callout"; readonly calloutType: CalloutType }
  | { readonly aspect: "list"; readonly isOrdered: boolean };

/** The document-order block descriptors one compile produced. */
export type BlockDescriptor = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  // Plain authored presentation text is retained for revision alignment and
  // diffing. It never enters an id or path and is not exposed as markup.
  readonly text: string;
  // Whether the block is a built-in component's root. Only this walk can
  // answer that structurally, so it is recorded here instead of being
  // re-derived downstream from kind strings.
  readonly isComponentRoot: boolean;
  // The id of the block that declared this one as a sub-target: the table for
  // its rows, columns, and cells, or the component root for its declared
  // internals. Absent on every top-level block.
  readonly ownerId?: string;
  /** Header labels carried by table rows so isolated row diffs keep semantics. */
  readonly tableHeaders?: ReadonlyArray<string>;
  readonly isTableHeader?: boolean;
  // The block's meaning-bearing presentation facts. Absent when the block
  // carries none, and absence downstream renders neutrally rather than as a
  // guessed default.
  readonly presentation?: BlockPresentation;
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

// Block-level tags whose boundaries must survive text extraction. Markdown
// HAST separates siblings with whitespace text nodes, but component views
// render through JSX, which has none - without an inserted boundary a
// component's headings, labels, cells, and list items run together into one
// unreadable string wherever the flattened text is shown or diffed.
const TEXT_BOUNDARY_TAGS = new Set([
  "p",
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "figure",
  "figcaption",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

// Flattens an element to plain text, keeping a newline at every block-level
// boundary so downstream consumers can tell adjacent units apart.
const textOf = (node: Element): string => {
  let text = "";
  const markBoundary = (): void => {
    if (text !== "" && !/\s$/.test(text)) {
      text += "\n";
    }
  };
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (isElement(child)) {
      // Screen-reader-only prefixes are announcement scaffolding, and markup
      // shipped with the hidden attribute (dormant controls, collapsed menus,
      // a component's hidden machine-readable source) is not presented to the
      // reader, so neither belongs to a block's diffable text.
      const className = child.properties.className;
      const hidden =
        (Array.isArray(className) && className.includes("sr-only")) ||
        (child.properties.hidden !== undefined &&
          child.properties.hidden !== false);
      if (!hidden) {
        const isBoundary = TEXT_BOUNDARY_TAGS.has(child.tagName);
        if (isBoundary) markBoundary();
        text += textOf(child);
        if (isBoundary) markBoundary();
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

const allocateScopeName = ({
  raw,
  used,
}: {
  readonly raw: string;
  readonly used: Set<string>;
}): string => {
  const base = idSegment(raw);
  for (let ordinal = 1; ; ordinal += 1) {
    const suffix = ordinal === 1 ? "" : `-${ordinal}`;
    const scope = `section/${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (!used.has(scope)) {
      used.add(scope);
      return scope;
    }
  }
};

const componentName = (node: Element): string | undefined => {
  const name = node.properties[COMPONENT_NAME_ATTRIBUTE];
  return typeof name === "string" && name.length > 0 ? name : undefined;
};

const declaredCommentKind = (node: Element): string | undefined => {
  const kind = node.properties["data-commentable-kind"];
  return typeof kind === "string" && kind.length > 0 ? kind : undefined;
};

const hasTitleClass = (node: Element): boolean => {
  const className = node.properties.className;
  return (
    Array.isArray(className) &&
    className.some(
      (value) =>
        typeof value === "string" &&
        (value === "title" || value.endsWith("-title")),
    )
  );
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
    // A component names itself through its question or heading when it has
    // one, so a tray row reads "Storage engine" rather than "Decision".
    const namedContent = findDescendant({
      node,
      match: (candidate) =>
        candidate.properties["data-decision-question"] !== undefined,
    });
    const heading =
      namedContent ??
      findDescendant({
        node,
        match: (candidate) => HEADING_TAGS.has(candidate.tagName),
      });
    const headingText = heading === undefined ? "" : summarize(textOf(heading));
    if (headingText.length > 0) {
      return headingText;
    }
    const semanticTitle = findDescendant({
      node,
      match: hasTitleClass,
    });
    const semanticTitleText =
      semanticTitle === undefined ? "" : summarize(textOf(semanticTitle));
    if (semanticTitleText.length > 0) {
      return semanticTitleText;
    }
    const caption = findDescendant({
      node,
      match: (candidate) => candidate.tagName === "figcaption",
    });
    const captionText = caption === undefined ? "" : summarize(textOf(caption));
    if (captionText.length > 0) {
      return captionText;
    }
    // When a component exposes no concise title, its full rendered body is a
    // poor accessible name: it swallows internal control labels ("Tier",
    // "Maximize", and so on) and makes scoped role queries ambiguous. The
    // component kind is the honest stable fallback.
    return readableKind(kind);
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

// Reads the meaning-bearing presentation facts off the stamped element. The
// callout view's data-callout attribute is its authored type contract, and a
// value outside that contract records nothing: an unknown fact must replay
// neutrally, never as a guessed "note". A dl also carries no fact, because a
// definition list makes neither an ordered nor an unordered claim.
const presentationOf = ({
  node,
  kind,
}: {
  readonly node: Element;
  readonly kind: string;
}): BlockPresentation | undefined => {
  if (kind === "callout") {
    const type = node.properties["data-callout"];
    const calloutType = CALLOUT_TYPES.find((candidate) => candidate === type);
    return calloutType === undefined
      ? undefined
      : { aspect: "callout", calloutType };
  }
  if (kind === "list" && (node.tagName === "ol" || node.tagName === "ul")) {
    return { aspect: "list", isOrdered: node.tagName === "ol" };
  }
  return undefined;
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
  const segment = idSegment(kind);
  const next = (counter.get(segment) ?? 0) + 1;
  counter.set(segment, next);
  return `${scope}/${segment}-${next}`;
};

const stampBlock = ({
  node,
  kind,
  label,
  scope,
  section,
  blocks,
  counter,
  isComponentRoot = false,
  ownerId,
  tableHeaders,
  isTableHeader = false,
}: {
  readonly node: Element;
  readonly kind: string;
  readonly label: string;
  readonly scope: string;
  readonly section: string;
  readonly blocks: Array<BlockDescriptor>;
  readonly counter: ScopeCounter;
  readonly isComponentRoot?: boolean;
  readonly ownerId?: string;
  readonly tableHeaders?: ReadonlyArray<string>;
  readonly isTableHeader?: boolean;
}): string => {
  const id = allocateId({ scope, kind, counter });
  node.properties["data-block-id"] = id;
  node.properties["data-block-kind"] = kind;
  node.properties["data-block-label"] = label;
  node.properties["data-block-section"] = section;
  const presentation = presentationOf({ node, kind });
  blocks.push({
    id,
    kind,
    label,
    section,
    text: textOf(node),
    isComponentRoot,
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(tableHeaders === undefined ? {} : { tableHeaders }),
    ...(isTableHeader ? { isTableHeader: true } : {}),
    ...(presentation === undefined ? {} : { presentation }),
  });
  return id;
};

// A Markdown table exposes the whole table, each row, every body cell, and one
// column target per header. A header cell is the column's authored name, so its
// single anchor honestly serves both the header cell and the whole column.
const stampTableTargets = ({
  table,
  tableId,
  scope,
  section,
  blocks,
  counter,
}: {
  readonly table: Element;
  readonly tableId: string;
  readonly scope: string;
  readonly section: string;
  readonly blocks: Array<BlockDescriptor>;
  readonly counter: ScopeCounter;
}): void => {
  let columnLabels: ReadonlyArray<string> = [];
  forEachDescendant({
    node: table,
    visit: (candidate) => {
      if (candidate.tagName !== "tr") {
        return;
      }
      const cells = candidate.children.filter(
        (child): child is Element =>
          isElement(child) &&
          (child.tagName === "th" || child.tagName === "td"),
      );
      const firstCell = cells[0];
      const label =
        firstCell === undefined ? "Table row" : summarize(textOf(firstCell));
      const isHeader = cells.some((cell) => cell.tagName === "th");
      if (isHeader) {
        columnLabels = cells.map((cell, index) => {
          const cellLabel = summarize(textOf(cell));
          return cellLabel.length > 0 ? cellLabel : `Column ${index + 1}`;
        });
      }
      stampBlock({
        node: candidate,
        kind: "table-row",
        label: label.length > 0 ? label : "Table row",
        scope,
        section,
        blocks,
        counter,
        ownerId: tableId,
        tableHeaders: columnLabels,
        isTableHeader: isHeader,
      });

      if (isHeader) {
        cells.forEach((cell, index) => {
          const cellLabel = summarize(textOf(cell));
          const columnLabel =
            cellLabel.length > 0 ? cellLabel : `Column ${index + 1}`;
          stampBlock({
            node: cell,
            kind: "table-column",
            label: `Column: ${columnLabel}`,
            scope,
            section,
            blocks,
            counter,
            ownerId: tableId,
          });
        });
        return;
      }

      cells.forEach((cell, index) => {
        const value = summarize(textOf(cell));
        const column = columnLabels[index] ?? `Column ${index + 1}`;
        stampBlock({
          node: cell,
          kind: "table-cell",
          label: `${column}: ${value.length > 0 ? value : "Empty"}`,
          scope,
          section,
          blocks,
          counter,
          ownerId: tableId,
        });
      });
    },
  });
};

const stampDeclaredTargets = ({
  component,
  componentId,
  scope,
  section,
  blocks,
  counter,
}: {
  readonly component: Element;
  readonly componentId: string;
  readonly scope: string;
  readonly section: string;
  readonly blocks: Array<BlockDescriptor>;
  readonly counter: ScopeCounter;
}): void => {
  forEachDescendant({
    node: component,
    visit: (candidate) => {
      const kind = declaredCommentKind(candidate);
      if (kind === undefined) {
        return;
      }
      const declaredLabel = candidate.properties["data-commentable-label"];
      const fallback = summarize(textOf(candidate));
      const label =
        typeof declaredLabel === "string" && declaredLabel.length > 0
          ? summarize(declaredLabel).replaceAll("`", "")
          : fallback.length > 0
            ? fallback
            : readableKind(kind);
      stampBlock({
        node: candidate,
        kind,
        label,
        scope,
        section,
        blocks,
        counter,
        ownerId: componentId,
      });
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
    const id = stampBlock({
      node: child,
      kind,
      label,
      scope,
      section,
      blocks,
      counter,
      isComponentRoot: componentName(child) !== undefined,
    });
    if (kind === "code" || kind.startsWith("code-")) {
      stampCodeLines(child);
    } else if (kind === "table") {
      stampTableTargets({
        table: child,
        tableId: id,
        scope,
        section,
        blocks,
        counter,
      });
    }
    if (componentName(child) !== undefined) {
      stampDeclaredTargets({
        component: child,
        componentId: id,
        scope,
        section,
        blocks,
        counter,
      });
    }
  }
};

// The scope a slide contributes: its heading's anchor, so a block id reads as
// a path a human can follow ("section/status-quo/paragraph-2").
const scopeNameFor = ({
  node,
  headingTag,
  fallback,
  used,
}: {
  readonly node: Element;
  readonly headingTag: string;
  readonly fallback: string;
  readonly used: Set<string>;
}): string => {
  const heading = findDescendant({
    node,
    match: (candidate) =>
      candidate.tagName === headingTag &&
      typeof candidate.properties.id === "string",
  });
  const id = heading?.properties.id;
  if (typeof id !== "string") {
    used.add(fallback);
    return fallback;
  }
  return allocateScopeName({ raw: id, used });
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
    const usedScopes = new Set(["document"]);
    let slideIndex = 0;
    const stampSlides = (container: Root | Element): void => {
      for (const child of container.children) {
        if (!isElement(child)) {
          continue;
        }
        const isSlide = child.properties["data-slide"] !== undefined;
        if (!isSlide) {
          stampSlides(child);
          continue;
        }
        slideIndex += 1;
        const isSubSlide = child.properties["data-subslide"] !== undefined;
        const scope = scopeNameFor({
          node: child,
          headingTag: isSubSlide ? "h3" : "h2",
          fallback: `slide/${slideIndex}`,
          used: usedScopes,
        });
        const sectionHeading = findDescendant({
          node: child,
          match: (candidate) =>
            candidate.tagName === (isSubSlide ? "h3" : "h2"),
        });
        const section =
          sectionHeading === undefined
            ? `Section ${slideIndex}`
            : summarize(textOf(sectionHeading)).replace(KICKER_PREFIX, "");
        stampScope({ container: child, scope, section, blocks: collected });
        // A grouped slide owns nested sub-slide scopes inside its body. Stamp
        // them independently after the parent so their blocks keep the h3
        // address instead of disappearing behind the outer frame.
        stampSlides(child);
      }
    };
    stampSlides(tree);
    blocks?.push(...collected);
  };
