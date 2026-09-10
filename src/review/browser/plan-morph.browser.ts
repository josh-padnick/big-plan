// Reconciles the live reading surface against a freshly rendered copy in place,
// instead of replacing the whole article at once. A wholesale replace detaches
// every node the reader was standing on - so it dropped the text selection, the
// caret in a field a block hosts, and any node identity the shell had wired -
// and the reader's only evidence that anything had moved was that the words
// were suddenly different. This keeps every block whose markup did not change,
// swaps only the ones that did, and reports which those were so a caller can
// mark exactly the changed blocks as freshly arrived.
//
// What "did not change" is judged against a pristine baseline of the last
// server render, never against the live DOM. The shell wires the live article
// after it loads - a collapse frame gains a `data-shown` and a selection span,
// a diagram gains state - so the live markup diverges from the server's copy
// without any authored content moving. Comparing live-to-server would call
// almost every block changed and rebuild it, which is the churn this exists to
// avoid. So the comparison is server-to-server: the new render against the
// remembered pristine one, which is why the baseline is seeded from a pristine
// fetch before the first refresh.
//
// The common refresh only edits the text inside some blocks. For that case the
// reconcile is exact: it replaces just the addressed leaf blocks whose bytes
// moved, in place, and touches nothing else - no wrapper, no sibling, and none
// of the state the shell wired onto them. Only when the set or order of blocks
// itself changed - a block added, removed, or moved - does it fall back to
// reconciling the article's top-level blocks by address, which can rebuild a
// whole top-level block but never the page.

/** The address a block or collapse frame is matched by across a refresh. */
const keyOf = (element: Element): string | null =>
  element.getAttribute("data-block-id") ??
  element.getAttribute("data-collapse-id");

/** Whether an addressed block or frame lives anywhere beneath a node. */
const hasKeyedDescendant = (element: Element): boolean =>
  Array.from(element.children).some(
    (child) => keyOf(child) !== null || hasKeyedDescendant(child),
  );

/** Every addressed block id at or beneath a node, for the freshly-arrived mark. */
const collectBlockIds = (element: Element, into: Set<string>): void => {
  const own = element.getAttribute("data-block-id");
  if (own !== null) into.add(own);
  for (const child of Array.from(element.children))
    collectBlockIds(child, into);
};

/** Every addressed node in a subtree, in document order. */
const keyedNodes = (root: Element): Array<Element> => {
  const found: Array<Element> = [];
  const walk = (element: Element): void => {
    if (keyOf(element) !== null) found.push(element);
    for (const child of Array.from(element.children)) walk(child);
  };
  for (const child of Array.from(root.children)) walk(child);
  return found;
};

// The pristine server markup of every addressed node the reader is currently
// shown, keyed by address. It is what a new render is compared against, so the
// comparison sees content moves rather than the live wiring's own edits.
const baseline = new Map<string, string>();

/** Records every keyed node's pristine markup, replacing any prior record. */
const rememberBaseline = (article: Element): void => {
  for (const node of keyedNodes(article)) {
    const key = keyOf(node);
    if (key !== null) baseline.set(key, node.outerHTML);
  }
};

/**
 * Seeds the baseline from a pristine copy of the reading surface, discarding
 * any prior one. It must run before the first refresh, from server markup the
 * shell has not yet wired, so the first comparison is server-to-server.
 */
export const seedPlanMorphBaseline = (article: Element): void => {
  baseline.clear();
  rememberBaseline(article);
};

/** Whether a pristine baseline has been seeded yet. */
export const hasPlanMorphBaseline = (): boolean => baseline.size > 0;

/**
 * Reconciles the article's top-level blocks by address: keeps an unchanged one,
 * replaces a changed one, inserts a new one, drops a removed one, and reorders
 * without rebuilding. This is the fallback for a structural change - a block
 * added, removed, or moved - so it may rebuild a whole top-level block (and
 * lose a selection inside that one block), but never the page, and never a
 * block that did not change. The common content edit never reaches here.
 */
const reconcileTopLevel = (
  current: Element,
  next: Element,
  changed: Set<string>,
): void => {
  const currentByKey = new Map<string, Element>();
  for (const child of Array.from(current.children)) {
    const key = keyOf(child);
    if (key !== null) currentByKey.set(key, child);
  }
  const desired: Array<Element> = [];
  for (const nextChild of Array.from(next.children)) {
    const key = keyOf(nextChild);
    const existing = key === null ? undefined : currentByKey.get(key);
    const unchanged =
      key !== null &&
      baseline.get(key) !== undefined &&
      baseline.get(key) === nextChild.outerHTML;
    if (
      existing !== undefined &&
      existing.tagName === nextChild.tagName &&
      unchanged
    ) {
      desired.push(existing);
      continue;
    }
    const imported = current.ownerDocument.importNode(nextChild, true);
    collectBlockIds(imported, changed);
    desired.push(imported);
  }
  for (const child of Array.from(current.childNodes)) {
    if (!(child instanceof Element) || !desired.includes(child)) {
      current.removeChild(child);
    }
  }
  let index = 0;
  for (const element of desired) {
    if (current.childNodes[index] !== element) {
      current.insertBefore(element, current.childNodes[index] ?? null);
    }
    index += 1;
  }
};

/**
 * Reconciles the live `<article>` against a freshly rendered one, in place.
 * Returns the ids of the blocks that were added or replaced - the set a caller
 * marks as freshly arrived - which is empty when nothing visible moved. The
 * baseline advances to the render just applied, so the next refresh is again
 * compared against pristine server markup.
 */
export const morphPlanArticle = (
  currentArticle: Element,
  nextArticle: Element,
): ReadonlyArray<string> => {
  const changed = new Set<string>();
  const liveNodes = keyedNodes(currentArticle);
  const nextNodes = keyedNodes(nextArticle);
  const sameStructure =
    liveNodes.length === nextNodes.length &&
    liveNodes.every((node, index) => {
      const nextNode = nextNodes[index];
      return nextNode !== undefined && keyOf(node) === keyOf(nextNode);
    });
  if (sameStructure) {
    // The blocks and their order are unchanged, so every content move is a
    // block whose bytes differ from its baseline. Replace just those leaf
    // blocks in place; a keyed frame's own difference is carried entirely by
    // the leaves inside it, so the frame - and the reader's state on it - is
    // never touched.
    const liveById = new Map(liveNodes.map((node) => [keyOf(node), node]));
    for (const nextNode of nextNodes) {
      const key = keyOf(nextNode);
      if (key === null || hasKeyedDescendant(nextNode)) continue;
      if (baseline.get(key) === nextNode.outerHTML) continue;
      const liveNode = liveById.get(key);
      if (liveNode === undefined) continue;
      liveNode.replaceWith(
        currentArticle.ownerDocument.importNode(nextNode, true),
      );
      changed.add(key);
    }
  } else {
    reconcileTopLevel(currentArticle, nextArticle, changed);
  }
  rememberBaseline(nextArticle);
  return [...changed];
};
