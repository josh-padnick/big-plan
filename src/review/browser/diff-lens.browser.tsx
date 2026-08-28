// Owns the What-changed lens shared by comment threads and plan-wide chat. It
// portals interaction chrome beside the server-rendered block without taking
// ownership of plan content.

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BlockPresentation,
  DiffLocation,
  DiffPlace,
  DiffRun,
  SnapshotDiff,
} from "../shared/review-wire.js";
import type { LensPlacement } from "./diff-anchor.js";
import {
  foundElement,
  LENS_STAND_IN_ATTRIBUTE,
  liveArticle,
  liveBlock,
  liveComponentDiff,
  liveLensAnchor,
} from "./live-target.browser.js";
import { useArticleVersion } from "./use-article-version.browser.js";
import { replacePlanDom } from "./plan-dom.browser.js";

const placeLocations = ({
  diff,
  place,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
}): ReadonlyArray<DiffLocation> =>
  place.locationIndexes.flatMap((index) => {
    const location = diff.locations.at(index);
    return location === undefined ? [] : [location];
  });

const runsWithChanges = (runs: ReadonlyArray<DiffRun>): ReactNode =>
  runs.map((run, index) => {
    if (run.op === "same") return <span key={index}>{run.text}</span>;
    if (run.op === "del") {
      return (
        <del
          key={index}
          className="rounded-sm bg-[var(--diff-remove-bg)] px-0.5 text-[var(--diff-remove-c)] decoration-2"
        >
          {run.text}
        </del>
      );
    }
    return (
      <ins
        key={index}
        className="rounded-sm bg-[var(--diff-add-bg)] px-0.5 font-medium text-[var(--diff-add-c)] no-underline"
      >
        {run.text}
      </ins>
    );
  });

const sideText = (location: DiffLocation, side: "old" | "new"): string =>
  side === "old" ? location.oldText : location.newText;

const sideView = (
  location: DiffLocation,
  side: "old" | "new",
): string | undefined => (side === "old" ? location.oldView : location.newView);

// A picture is evidence, not words: its extracted text is empty, so a lens
// that shows only text drops the very block the reviewer asked about. The
// compiled rendering is the honest content for that side.
const isRenderedPicture = (location: DiffLocation): boolean =>
  location.kind === "image";

/** Whether one side of a location has anything at all to show. */
const hasSideContent = (location: DiffLocation, side: "old" | "new"): boolean =>
  sideText(location, side).trim() !== "" ||
  (isRenderedPicture(location) && sideView(location, side) !== undefined);

// A picture replayed inert. It is the last block the lens shows as markup, and
// it needs none of the machinery a component copy once needed: a picture has
// no controls to neutralise and no identity to scrub, because the engine
// isolated the side before it reached the wire. It stands in for the words a
// text side would carry, so it claims the diff-content marker the rest of the
// lens vocabulary uses.
const PictureEvidence = ({ view }: { readonly view: string | undefined }) => (
  <div
    className="pointer-events-none min-w-0"
    inert
    data-review-diff-content=""
    dangerouslySetInnerHTML={{ __html: view ?? "" }}
  />
);

// Each side replays the meaning-bearing presentation facts its own snapshot
// recorded on the wire. The live document can answer only for a block it still
// contains - and then only with the current side's facts - so the lens never
// asks it; an absent fact renders neutrally instead of as a guessed default.
const sidePresentation = (
  location: DiffLocation,
  side: "old" | "new",
): BlockPresentation | undefined =>
  side === "old" ? location.oldPresentation : location.newPresentation;

const listPresentationChanged = (location: DiffLocation): boolean =>
  location.oldPresentation?.aspect === "list" &&
  location.newPresentation?.aspect === "list" &&
  location.oldPresentation.isOrdered !== location.newPresentation.isOrdered;

// A block that declares sub-targets deliberately overlaps with them for
// attribution: a table with its rows, columns, and cells, and a component
// root with its declared internals. A presentation must choose one
// non-overlapping level or it repeats the same text several times, so rows
// win over every other table identity and declared internals win over the
// component root that contains them.
const presentationLocations = (
  locations: ReadonlyArray<DiffLocation>,
): ReadonlyArray<DiffLocation> => {
  const wholeComponentIds = new Set(
    locations.flatMap((location) =>
      location.isComponentRoot && location.status !== "changed"
        ? [location.oldBlockId, location.newBlockId].filter(
            (id): id is string => id !== undefined,
          )
        : [],
    ),
  );
  let visible = locations.filter(
    (location) =>
      location.ownerId === undefined ||
      !wholeComponentIds.has(location.ownerId),
  );
  if (visible.some((location) => location.kind === "table-row")) {
    visible = visible.filter(
      (location) =>
        location.kind !== "table" &&
        location.kind !== "data-table" &&
        location.kind !== "table-column" &&
        location.kind !== "table-cell",
    );
  }
  const declaredOwners = new Set(
    visible.flatMap((location) =>
      location.ownerId === undefined ? [] : [location.ownerId],
    ),
  );
  return visible.filter(
    (location) =>
      !location.isComponentRoot ||
      ![location.oldBlockId, location.newBlockId].some(
        (id) => id !== undefined && declaredOwners.has(id),
      ),
  );
};

type ProsePresentation =
  | "paragraph"
  | "lede"
  | "quote"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6";

const prosePresentationFor = (
  anchor: HTMLElement,
): ProsePresentation | undefined => {
  const tag = anchor.tagName.toLocaleLowerCase();
  if (/^h[1-6]$/u.test(tag)) {
    return `heading-${tag.slice(1)}` as ProsePresentation;
  }
  if (tag === "blockquote") return "quote";
  if (tag !== "p") return undefined;
  return anchor.previousElementSibling?.matches("h1[data-authored-prose]") ===
    true
    ? "lede"
    : "paragraph";
};

const WordRunContent = ({
  runs,
  presentation,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly presentation?: ProsePresentation;
}) => {
  const content = runsWithChanges(runs);
  const properties = {
    className: "m-0 max-w-[var(--measure)] [overflow-wrap:anywhere]",
    "data-authored-prose": "",
    "data-review-diff-content": "",
    "data-review-diff-presentation": presentation ?? "paragraph",
  } as const;
  switch (presentation) {
    case "heading-1":
      return <h1 {...properties}>{content}</h1>;
    case "heading-2":
      return <h2 {...properties}>{content}</h2>;
    case "heading-3":
      return <h3 {...properties}>{content}</h3>;
    case "heading-4":
      return <h4 {...properties}>{content}</h4>;
    case "heading-5":
      return <h5 {...properties}>{content}</h5>;
    case "heading-6":
      return <h6 {...properties}>{content}</h6>;
    case "quote":
      return <blockquote {...properties}>{content}</blockquote>;
    default:
      return <p {...properties}>{content}</p>;
  }
};

/** Preserves list-item boundaries while reusing the centralized word diff. */
const runsByLine = (
  runs: ReadonlyArray<DiffRun>,
): ReadonlyArray<ReadonlyArray<DiffRun>> => {
  const lines: Array<Array<DiffRun>> = [[]];
  for (const run of runs) {
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (part !== "") lines.at(-1)?.push({ ...run, text: part });
      if (index < parts.length - 1) lines.push([]);
    });
  }
  return lines.filter((line) => line.some((run) => run.text.trim() !== ""));
};

// The list container for diffed list content. Ordering is a meaning-bearing
// authored fact carried per side on the wire: an unknown fact renders a
// marker-free list, because bullets and numbers each assert a claim about
// sequence that nothing recorded.
const DiffList = ({
  presentation,
  children,
}: {
  readonly presentation: BlockPresentation | undefined;
  readonly children: ReactNode;
}) => {
  if (presentation?.aspect === "list") {
    const List = presentation.isOrdered ? "ol" : "ul";
    return (
      <List data-authored-prose="" data-review-diff-content="">
        {children}
      </List>
    );
  }
  return (
    <ul
      className="list-none"
      data-authored-prose=""
      data-review-diff-content=""
    >
      {children}
    </ul>
  );
};

const ListRunContent = ({
  runs,
  location,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly location: DiffLocation;
}) => (
  // The merged word-run view shows one list for both sides, so it carries the
  // Now side's ordering - the plan the reader is accepting - and falls back to
  // the Was side's only when the new fact is absent.
  <DiffList presentation={location.newPresentation ?? location.oldPresentation}>
    {runsByLine(runs).map((line, index) => (
      <li
        key={`${index}-${line.map((run) => run.text).join("")}`}
        data-authored-prose=""
      >
        {runsWithChanges(line)}
      </li>
    ))}
  </DiffList>
);

const SnapshotTable = ({
  rows,
  side,
}: {
  readonly rows: ReadonlyArray<DiffLocation>;
  readonly side: "old" | "new";
}) => (
  <div className="max-w-full min-w-0 overflow-hidden">
    <table
      className={`w-full table-fixed ${
        side === "old"
          ? "[&_th]:bg-[color-mix(in_srgb,var(--diff-remove-c)_18%,var(--diff-remove-bg))]"
          : "[&_th]:bg-[color-mix(in_srgb,var(--diff-add-c)_18%,var(--diff-add-bg))]"
      }`}
      data-authored-prose=""
      data-review-diff-table=""
    >
      {(() => {
        const headers = rows.find((row) =>
          side === "old"
            ? row.oldTableHeaders !== undefined
            : row.newTableHeaders !== undefined,
        );
        const labels =
          side === "old" ? headers?.oldTableHeaders : headers?.newTableHeaders;
        return labels === undefined ? null : (
          <thead data-authored-prose="">
            <tr data-authored-prose="">
              {labels.map((label) => (
                <th key={label} data-authored-prose="">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
        );
      })()}
      <tbody data-authored-prose="">
        {rows
          .filter((row) => !row.isTableHeader)
          .map((row, rowIndex) => {
            const cells = sideText(row, side).trim().split(/\n+/u);
            return (
              <tr key={`${row.scope}-${rowIndex}`} data-authored-prose="">
                {cells.map((cell, cellIndex) => {
                  return (
                    <td
                      key={`${cellIndex}-${cell}`}
                      className="min-w-0 [overflow-wrap:anywhere]"
                      data-authored-prose=""
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            );
          })}
      </tbody>
    </table>
  </div>
);

// The words a field's body repeats from its label: a plain label repeats
// itself ("Why"), while a prefixed label repeats only its subject
// ("Column: user_id" opens with "user_id").
const fieldTermOf = (label: string): string => {
  const trimmed = label.trim();
  const separator = trimmed.indexOf(": ");
  return separator < 0 ? trimmed : trimmed.slice(separator + 2).trim();
};

// A field's flattened text leads with the words its own label already names,
// so that lead is stripped before the body is shown under the label header.
const fieldBodyText = (location: DiffLocation, side: "old" | "new"): string => {
  const term = fieldTermOf(location.label);
  const raw = sideText(location, side).trim();
  return raw.startsWith(term) ? raw.slice(term.length).trim() : raw;
};

const FieldTerm = ({ location }: { readonly location: DiffLocation }) => (
  <strong className="mb-1 block text-2xs font-semibold uppercase tracking-caps">
    {location.label.trim()}
  </strong>
);

const SnapshotFieldBlock = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const body = fieldBodyText(location, side);
  const items = body
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return (
    <div data-review-diff-field="">
      <FieldTerm location={location} />
      {items.length > 1 ? (
        <ul className="m-0 list-disc pl-4" data-authored-prose="">
          {items.map((item, index) => (
            <li key={`${index}-${item}`} data-authored-prose="">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0" data-authored-prose="">
          {body}
        </p>
      )}
    </div>
  );
};

/** Drops the field term the header already names from the leading run. */
const runsWithoutLeadingTerm = (
  runs: ReadonlyArray<DiffRun>,
  term: string,
): ReadonlyArray<DiffRun> => {
  const [first, ...rest] = runs;
  if (first === undefined || first.op !== "same") return runs;
  const text = first.text.trimStart();
  if (!text.startsWith(term)) return runs;
  const remainder = text.slice(term.length).trimStart();
  return remainder === "" ? rest : [{ op: "same", text: remainder }, ...rest];
};

// The word-level lens for one reworded field: the field's label stays a calm
// header while the body carries the exact removed and inserted words, with
// authored line boundaries preserved so multi-line fields read as their lines.
const FieldRunContent = ({
  runs,
  location,
}: {
  readonly runs: ReadonlyArray<DiffRun>;
  readonly location: DiffLocation;
}) => (
  <div data-review-diff-field="">
    <FieldTerm location={location} />
    <p
      className="m-0 max-w-[var(--measure)] whitespace-pre-line [overflow-wrap:anywhere]"
      data-authored-prose=""
      data-review-diff-content=""
      data-review-diff-presentation="field"
    >
      {runsWithChanges(
        runsWithoutLeadingTerm(runs, fieldTermOf(location.label)),
      )}
    </p>
  </div>
);

const SnapshotBlock = ({
  location,
  side,
}: {
  readonly location: DiffLocation;
  readonly side: "old" | "new";
}) => {
  const text = sideText(location, side);
  if (isRenderedPicture(location)) {
    // The lens is evidence beside the plan, not a second copy of the page: a
    // picture is shown small enough that the reader can still see the words
    // that changed with it, and the plan itself holds the full-size version.
    return (
      <div className="[&_img]:my-0 [&_img]:max-h-48 [&_img]:w-auto">
        <PictureEvidence view={sideView(location, side)} />
      </div>
    );
  }
  if (location.ownerId !== undefined) {
    return <SnapshotFieldBlock location={location} side={side} />;
  }
  if (location.kind === "heading") {
    return (
      <h3 data-authored-prose="" data-review-diff-content="">
        {text}
      </h3>
    );
  }
  if (location.kind === "quote") {
    return (
      <blockquote data-authored-prose="" data-review-diff-content="">
        {text}
      </blockquote>
    );
  }
  if (location.kind === "code" || location.kind.startsWith("code-")) {
    return (
      <pre data-authored-prose="" data-review-diff-content="">
        <code data-authored-prose="">{text}</code>
      </pre>
    );
  }
  if (location.kind === "list") {
    const items = text
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return (
      <DiffList presentation={sidePresentation(location, side)}>
        {items.map((item, index) => (
          <li key={`${index}-${item}`} data-authored-prose="">
            {item}
          </li>
        ))}
      </DiffList>
    );
  }
  return (
    <p data-authored-prose="" data-review-diff-content="">
      {text}
    </p>
  );
};

const SnapshotSideContent = ({
  locations,
  side,
}: {
  readonly locations: ReadonlyArray<DiffLocation>;
  readonly side: "old" | "new";
}) => {
  const visible = locations.filter((location) =>
    hasSideContent(location, side),
  );
  const tableRows = visible.filter((location) => location.kind === "table-row");
  const firstTableRow = tableRows[0];
  return visible.map((location, index) => {
    if (location.kind === "table-row") {
      return location === firstTableRow ? (
        <SnapshotTable key={`table-${side}`} rows={tableRows} side={side} />
      ) : null;
    }
    return (
      <SnapshotBlock
        key={`${location.scope}-${location.kind}-${index}`}
        location={location}
        side={side}
      />
    );
  });
};

/**
 * Replays a component's own diff view where the lens shows a change beside the
 * plan rather than in place of it. Two paths reach here: the historical
 * archive, where the block is gone, and a superseded change, where the block
 * survives but the lens hides it and stands in front of it, because a revision
 * the plan has already moved past is evidence rather than a live question.
 *
 * Both paths need the same thing. The view carries the root and any proposed
 * field addresses the renderer copied into it. Remove all of them here: an
 * address the plan still holds - which the superseded path proves is not
 * hypothetical - must never appear twice in one document. Held inert for the
 * same reason, since neither path is answerable.
 */
const ReplayedComponentDiff = ({ view }: { readonly view: string }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const parsed = new DOMParser().parseFromString(view, "text/html");
    const root = parsed.body.firstElementChild;
    if (root === null) return;
    const addressed = [
      root,
      ...root.querySelectorAll(
        "[data-block-id], [data-block-kind], [data-block-label], [data-block-section]",
      ),
    ];
    for (const element of addressed) {
      for (const attribute of element.getAttributeNames()) {
        if (attribute.startsWith("data-block-")) {
          element.removeAttribute(attribute);
        }
      }
    }
    host.replaceChildren(document.importNode(root, true));
    return () => host.replaceChildren();
  }, [view]);
  return <div className="min-w-0" inert ref={hostRef} />;
};

/** Renders the common word-level or stacked Was/Now lens vocabulary. */
export const DiffLensContent = ({
  diff,
  place,
  isHistorical,
  isSuperseded,
  presentation,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isHistorical: boolean;
  readonly isSuperseded: boolean;
  readonly presentation?: ProsePresentation;
}) => {
  const locations = useMemo(
    () => placeLocations({ diff, place }),
    [diff, place],
  );
  // One overlap-free level is chosen up front so a component root grouped
  // with its declared sub-targets never repeats their text.
  const visibleLocations = useMemo(
    () => presentationLocations(locations),
    [locations],
  );
  const only = visibleLocations.length === 1 ? visibleLocations[0] : undefined;
  const canUseWordRuns =
    only?.status === "changed" &&
    place.note === "reworded" &&
    !listPresentationChanged(only) &&
    (only.kind === "paragraph" ||
      only.kind === "heading" ||
      only.kind === "quote" ||
      only.kind === "list" ||
      only.ownerId !== undefined);
  const hasOldText = visibleLocations.some((location) =>
    hasSideContent(location, "old"),
  );
  const hasNewText = visibleLocations.some((location) =>
    hasSideContent(location, "new"),
  );
  // A picture stays inside the stacked Was/Now panels beside the words that
  // changed with it. A component root brings its own complete diff view, so it
  // takes the lens over. A change the plan still holds never arrives here at
  // all - it replaces its own block instead - so reaching this point means the
  // change is archived or superseded, and the replay handles both.
  const componentLocation = visibleLocations.find(
    (location) => location.view !== undefined,
  );
  const title = isHistorical
    ? "Updated"
    : isSuperseded
      ? "What changed - plan revised again"
      : "What changed";
  return (
    <section
      className="grid w-full min-w-0 max-w-[var(--measure)] grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-dashed border-accent bg-raised p-4 text-ink shadow-raised"
      aria-label={title}
      data-review-diff-lens=""
      data-review-diff-note={place.note}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <strong
          className={`rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-caps ${
            isHistorical
              ? "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
              : "bg-accent-soft text-accent"
          }`}
        >
          {title}
        </strong>
        <em className="text-2xs text-muted">{place.note}</em>
      </div>
      {componentLocation?.view !== undefined ? (
        <ReplayedComponentDiff view={componentLocation.view} />
      ) : canUseWordRuns && only !== undefined ? (
        only.kind === "list" ? (
          <ListRunContent runs={only.runs} location={only} />
        ) : only.ownerId !== undefined ? (
          <FieldRunContent runs={only.runs} location={only} />
        ) : (
          <WordRunContent runs={only.runs} presentation={presentation} />
        )
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          {!hasOldText ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-remove-bg)] p-3 text-[var(--diff-remove-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Was
              </strong>
              <div className="min-w-0 [&>:last-child]:mb-0">
                <SnapshotSideContent locations={visibleLocations} side="old" />
              </div>
            </div>
          )}
          {!hasNewText ? null : (
            <div className="min-w-0 rounded-lg bg-[var(--diff-add-bg)] p-3 text-[var(--diff-add-c)] inset-shadow-well">
              <strong className="mb-1 block text-2xs uppercase tracking-caps">
                Now
              </strong>
              <div className="min-w-0 [&>:last-child]:mb-0">
                <SnapshotSideContent locations={visibleLocations} side="new" />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

type LensAnchor = {
  readonly element: HTMLElement;
  readonly placement: LensPlacement;
};

/** Uses instant scrolling when the reader asks the viewer to reduce motion. */
const lensScrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

/**
 * Finds the first of a place's locations that still has somewhere to land. A
 * place can describe several locations, and one unresolvable location does not
 * make the place historical while another can still show the change in place.
 */
const firstLiveAnchor = (
  locations: ReadonlyArray<DiffLocation>,
  isSuperseded: boolean,
): LensAnchor | null => {
  for (const location of locations) {
    const anchor = liveLensAnchor(location, { isSuperseded });
    if ("found" in anchor) {
      return { element: anchor.found, placement: anchor.placement };
    }
  }
  return null;
};

const LegacyDiffLensPortal = ({
  diff,
  place,
  isVisible,
  isSuperseded,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isVisible: boolean;
  readonly isSuperseded: boolean;
}) => {
  const locations = useMemo(
    () => placeLocations({ diff, place }),
    [diff, place],
  );
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [isHistorical, setIsHistorical] = useState(false);
  const [presentation, setPresentation] = useState<ProsePresentation>();
  // The host, the anchor it sits beside, and the blocks it hides all belong to
  // the article that was displayed when the lens opened. A refresh replaces
  // that article, so the lens re-resolves against the new one: it lands beside
  // the revised block, or falls back to the archive when the block it was
  // showing is no longer there.
  const articleVersion = useArticleVersion();
  useEffect(() => {
    if (!isVisible) {
      setHost(null);
      setPresentation(undefined);
      return;
    }
    const anchor = firstLiveAnchor(locations, isSuperseded);
    if (anchor === null) {
      setIsHistorical(true);
      setPresentation(undefined);
      const article = liveArticle();
      if (article === null) {
        setHost(null);
        return;
      }
      const container = document.createElement("div");
      container.dataset.reviewDiffLensHost = "";
      container.dataset.reviewHistoricalDiff = "";
      container.className =
        "mx-auto my-4 min-w-0 w-full max-w-[var(--measure)] px-4";
      let archive = article.querySelector<HTMLElement>(
        "[data-review-historical-changes]",
      );
      const ownsArchive = archive === null;
      if (archive === null) {
        archive = document.createElement("section");
        archive.dataset.reviewHistoricalChanges = "";
        archive.className = "mx-auto my-8 w-full max-w-[var(--measure)]";
        archive.setAttribute("aria-label", "Historical changes");
        const slides = article.querySelectorAll<HTMLElement>("[data-slide]");
        const lastSlide = slides.item(slides.length - 1);
        if (lastSlide === null) article.append(archive);
        else lastSlide.after(archive);
      }
      archive.append(container);
      setHost(container);
      requestAnimationFrame(() =>
        container.scrollIntoView({
          behavior: lensScrollBehavior(),
          block: "center",
        }),
      );
      return () => {
        container.remove();
        if (ownsArchive && archive?.childElementCount === 0) archive.remove();
      };
    }
    setIsHistorical(false);
    setPresentation(prosePresentationFor(anchor.element));
    const replaced = locations
      .map((location) => location.newBlockId)
      .filter((blockId): blockId is string => blockId !== undefined)
      .map((blockId) => ({
        blockId,
        element: foundElement(liveBlock(blockId)),
      }))
      .filter(
        (entry): entry is { blockId: string; element: HTMLElement } =>
          entry.element !== null,
      );
    const direct = replaced.map((entry) => entry.element);
    const originalWireframes = [
      anchor.placement === "replace"
        ? anchor.element.closest<HTMLElement>("[data-wireframe]")
        : null,
      ...direct.map((element) =>
        element.closest<HTMLElement>("[data-wireframe]"),
      ),
    ].filter(
      (element): element is HTMLElement =>
        element !== null && element !== undefined,
    );
    const pictureHosts = direct
      .map((element) => element.nextElementSibling)
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.dataset.reviewImageHost !== undefined,
      );
    const hiddenElements = [
      ...new Set([...direct, ...originalWireframes, ...pictureHosts]),
    ];
    const displayValues = hiddenElements.map(
      (element) => element.style.display,
    );
    hiddenElements.forEach((element) => {
      element.style.display = "none";
    });
    const container = document.createElement("div");
    container.dataset.reviewDiffLensHost = "";
    // A hidden block has no box, so anything sending a reader to it would
    // scroll nowhere. Naming the blocks this lens shows in place of is what
    // lets a jump land on the content the reader can actually see.
    container.setAttribute(
      LENS_STAND_IN_ATTRIBUTE,
      replaced.map((entry) => entry.blockId).join(" "),
    );
    container.className = "my-4 min-w-0 max-w-full";
    let removalNode: HTMLElement = container;
    const target = anchor.element;
    if (target instanceof HTMLTableRowElement) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, target.cells.length);
      cell.append(container);
      row.append(cell);
      if (anchor.placement === "after") target.after(row);
      else target.before(row);
      removalNode = row;
    } else if (anchor.placement === "after") {
      target.after(container);
    } else {
      target.before(container);
    }
    setHost(container);
    requestAnimationFrame(() =>
      container.scrollIntoView({
        behavior: lensScrollBehavior(),
        block: "center",
      }),
    );
    return () => {
      hiddenElements.forEach((element, index) => {
        element.style.display = displayValues[index] ?? "";
      });
      removalNode.remove();
    };
  }, [articleVersion, isSuperseded, isVisible, locations]);
  return host === null
    ? null
    : createPortal(
        <DiffLensContent
          diff={diff}
          place={place}
          isHistorical={isHistorical}
          isSuperseded={isSuperseded}
          presentation={presentation}
        />,
        host,
      );
};

/** Parses one trusted server-rendered component diff into a live DOM root. */
const componentDiffRoot = (view: string): HTMLElement | null => {
  const parsed = new DOMParser().parseFromString(view, "text/html");
  const root = parsed.body.firstElementChild;
  return root instanceof HTMLElement ? document.importNode(root, true) : null;
};

const applyDecisionReviewAuthority = ({
  root,
  isAccepted,
}: {
  readonly root: HTMLElement;
  readonly isAccepted: boolean;
}): void => {
  const decision = root.querySelector<HTMLElement>(
    '[data-component-diff-side="proposed"] [data-decision]',
  );
  if (decision === null) return;
  decision.toggleAttribute("data-decision-change-open", !isAccepted);
};

/**
 * Replaces the real component root for a migrated diff and restores the exact
 * node that was there when the tour leaves. A full article refresh detaches
 * both nodes, so the replacement is resolved and installed again.
 */
const ComponentDiffReplacement = ({
  location,
  isAccepted,
}: {
  readonly location: DiffLocation;
  readonly isAccepted: boolean;
}) => {
  const replacementRef = useRef<HTMLElement | null>(null);
  const locationRef = useRef(location);
  const acceptedRef = useRef(isAccepted);
  useLayoutEffect(() => {
    locationRef.current = location;
    acceptedRef.current = isAccepted;
  }, [isAccepted, location]);
  useEffect(() => {
    if (location.view === undefined) return;
    let original: HTMLElement | null = null;
    let replacement: HTMLElement | null = null;

    const install = (): void => {
      const next = componentDiffRoot(location.view ?? "");
      if (next === null) return;
      const anchor = liveLensAnchor(locationRef.current, {
        isSuperseded: false,
      });
      if ("missing" in anchor) return;
      replacement = next;
      replacementRef.current = next;
      applyDecisionReviewAuthority({
        root: next,
        isAccepted: acceptedRef.current,
      });
      if (anchor.placement === "replace") {
        original = anchor.found;
        replacePlanDom({ target: anchor.found, replacement: next });
      } else {
        if (anchor.placement === "before") anchor.found.before(next);
        else anchor.found.after(next);
        document.dispatchEvent(new CustomEvent("bigplan:article-replaced"));
      }
      document.dispatchEvent(new CustomEvent("bigplan:review-authority"));
      next.scrollIntoView({ behavior: lensScrollBehavior(), block: "center" });
    };

    const reinstallAfterArticleRefresh = (): void => {
      if (replacement?.isConnected === true) return;
      const refreshed = liveComponentDiff(locationRef.current);
      if (refreshed !== null) {
        replacement = refreshed;
        replacementRef.current = refreshed;
        applyDecisionReviewAuthority({
          root: refreshed,
          isAccepted: acceptedRef.current,
        });
        document.dispatchEvent(new CustomEvent("bigplan:review-authority"));
        return;
      }
      install();
    };
    install();
    document.addEventListener(
      "bigplan:article-replaced",
      reinstallAfterArticleRefresh,
    );
    return () => {
      document.removeEventListener(
        "bigplan:article-replaced",
        reinstallAfterArticleRefresh,
      );
      replacementRef.current = null;
      const liveReplacement =
        liveComponentDiff(locationRef.current) ??
        (replacement?.isConnected === true ? replacement : null);
      if (liveReplacement !== null && original !== null) {
        replacePlanDom({ target: liveReplacement, replacement: original });
      } else if (liveReplacement !== null) {
        liveReplacement.remove();
        document.dispatchEvent(new CustomEvent("bigplan:article-replaced"));
      }
    };
  }, [
    location.afterBlockId,
    location.beforeBlockId,
    location.newBlockId,
    location.oldBlockId,
    location.view,
  ]);

  useEffect(() => {
    const replacement = replacementRef.current;
    if (replacement === null) return;
    applyDecisionReviewAuthority({ root: replacement, isAccepted });
    document.dispatchEvent(new CustomEvent("bigplan:review-authority"));
  }, [isAccepted, location.view]);

  return null;
};

/** Chooses the component-owned replacement only for a migrated root. */
export const DiffLensPortal = ({
  diff,
  place,
  isVisible,
  isSuperseded,
  isAccepted,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isVisible: boolean;
  readonly isSuperseded: boolean;
  readonly isAccepted: boolean;
}) => {
  const componentLocation = useMemo(
    () =>
      placeLocations({ diff, place }).find(
        (location) => location.view !== undefined,
      ),
    [diff, place],
  );
  const articleVersion = useArticleVersion();
  const [componentAvailable, setComponentAvailable] = useState<boolean>();
  useEffect(() => {
    if (componentLocation === undefined) return;
    setComponentAvailable(
      "found" in liveLensAnchor(componentLocation, { isSuperseded: false }),
    );
  }, [articleVersion, componentLocation]);
  // A superseded or unanchored change can land only in the historical archive,
  // whose one surviving copy must carry no plan identity. That copy is now the
  // component's own diff view replayed without its root address, so the archive
  // shows the same card the plan does rather than a scrubbed stand-in.
  if (componentLocation === undefined || !isVisible || isSuperseded) {
    return (
      <LegacyDiffLensPortal
        diff={diff}
        place={place}
        isVisible={isVisible}
        isSuperseded={isSuperseded}
      />
    );
  }
  if (componentAvailable === undefined) return null;
  return !componentAvailable ? (
    <LegacyDiffLensPortal
      diff={diff}
      place={place}
      isVisible={isVisible}
      isSuperseded={isSuperseded}
    />
  ) : (
    <ComponentDiffReplacement
      location={componentLocation}
      isAccepted={isAccepted}
    />
  );
};
