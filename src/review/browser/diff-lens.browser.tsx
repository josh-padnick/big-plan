// Owns the What-changed lens shared by comment threads and plan-wide chat. It
// portals interaction chrome beside the server-rendered block without taking
// ownership of plan content.
//
// A place the reviewer has accepted is deliberately not lensed. The proposal
// treatment - the dashed What-changed card, the word-level insertions and
// deletions, the component's Was/Now replacement - is the question being asked,
// so leaving it up after the answer would keep asking it. An accepted place
// therefore shows the plan's own blocks exactly as the document renders them,
// marked only well enough for the stepper to say which one it is on, and the
// evidence comes back on demand through the stepper's own control.

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
import { NO_REVEAL_HONOURED, shouldHonourReveal } from "./lens-reveal.js";
import {
  foundElement,
  liveBlock,
  liveComponentDiff,
  liveLensAnchor,
  type LiveTargetMissReason,
} from "./live-target.browser.js";
import { useArticleVersion } from "./use-article-version.browser.js";
import { announcePlanDom, replacePlanDom } from "./plan-dom.browser.js";
import { diffScrollTarget } from "./diff-scroll.js";

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
// non-overlapping level or it repeats the same text several times. A compiled
// component diff is already that component's overlap-free projection, so it
// wins intact; only the legacy text fallback chooses rows or declared fields.
export const presentationLocations = (
  locations: ReadonlyArray<DiffLocation>,
): ReadonlyArray<DiffLocation> => {
  const component = locations.find(
    (location) => location.isComponentRoot && location.view !== undefined,
  );
  if (component !== undefined) return [component];
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
 * Replays a component's own diff view in the historical archive, where the
 * block the change named is gone from the plan and the card has nowhere of its
 * own to stand. A change whose block survives is shown by replacing that
 * block instead, so this is the one path that stands a second copy beside the
 * plan rather than in place of it.
 *
 * That is what the two transforms here are for. The view carries the root and
 * any proposed field addresses the renderer copied into it; remove all of them,
 * because a copy standing beside the plan would otherwise publish an address a
 * second time. Held inert for the matching reason: a change the plan no longer
 * holds is a record, and a record with working controls invites the reader to
 * answer a question that is no longer being asked.
 *
 * Neither transform may travel with the card into the plan proper. `inert` is
 * inherited and silent - the subtree keeps its handlers, its `pointer-events`,
 * and its enabled controls, and only hit testing and focus quietly stop
 * reaching it - so a card held inert anywhere a reader expects to use it reads
 * as a dead component rather than as history.
 *
 * Installing the markup is a plan-DOM replacement like any other, and it is
 * announced as one. A component that sizes itself in the browser - a wireframe
 * scaling a fixed workspace into the measure it was given, a table deciding
 * how to fit - has no layout at all until the shell runs over it, and an
 * unannounced install leaves it at its natural size: a screen drawn at its
 * authored 1200px inside a column half that wide. Nothing throws, so the only
 * evidence is a replay that reads as broken.
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
    announcePlanDom({ carriesNoPlanIdentity: true });
    return () => {
      host.replaceChildren();
    };
  }, [view]);
  return <div className="min-w-0" inert ref={hostRef} />;
};

/** Renders the common word-level or stacked Was/Now lens vocabulary. */
export const DiffLensContent = ({
  diff,
  place,
  isSuperseded,
  presentation,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
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
  // Two states, not three. A change the plan has no place for renders nothing
  // at all now, so there is no third "Updated" card standing apart from the
  // document; what a superseded change gets is the same lens with a title that
  // says the recorded words are history.
  const title = isSuperseded
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
            isSuperseded
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
// The reveal the reader has already been taken to. Module state because only
// one tour lens is on screen at a time and the ask has to survive the lens
// being unmounted and mounted again by the very gesture that made it.
let honouredReveal = NO_REVEAL_HONOURED;

const lensScrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

/**
 * Puts one change where `diffScrollTarget` says it belongs.
 *
 * The frame is measured here rather than passed in, because every caller is
 * asking the same question about a card it has just put into the document, and
 * the two edges that bound the answer - the sticky header and the stepper -
 * belong to the page rather than to any one lens. Both are read live: a change
 * opened from a thread has no stepper under it, and the header's height is a
 * style decision this must not carry a copy of.
 */
const positionChange = (card: HTMLElement): void => {
  const header = document.querySelector<HTMLElement>("header");
  const stepper = document.querySelector<HTMLElement>(
    "[data-review-diff-stepper]",
  );
  const rect = card.getBoundingClientRect();
  window.scrollTo({
    top: diffScrollTarget({
      cardTop: rect.top + window.scrollY,
      cardHeight: rect.height,
      readingTop: header?.getBoundingClientRect().height ?? 0,
      floorTop:
        stepper?.getBoundingClientRect().top ??
        document.documentElement.clientHeight,
      maxScroll: Math.max(
        0,
        document.documentElement.scrollHeight -
          document.documentElement.clientHeight,
      ),
    }),
    behavior: lensScrollBehavior(),
  });
};

/**
 * Opens one change, and keeps opening it until it stops changing size.
 *
 * A card's height is not settled when it is inserted. A component that sizes
 * itself in the browser - a wireframe scaling a drawing into the measure it
 * was given - reaches its real height a frame or more later, over a fit that
 * runs several passes. Positioning once against the height at insertion lands
 * the reader tens of pixels off, and off in the direction that hides the end
 * of the change behind the stepper, which is the one edge the position exists
 * to respect.
 *
 * So the position is re-taken while the card is still resizing, and given up
 * the moment either the size settles or the reader takes over: scrolling is
 * theirs from their first gesture, and a lens that kept pulling the page back
 * would be worse than one that landed badly.
 */
const openChangeAtReadingPosition = (card: HTMLElement): (() => void) => {
  let settledHeight = -1;
  let passes = 0;
  let observer: ResizeObserver | null = null;
  let openingFrame: number | null = null;
  let settlingFrame: number | null = null;
  let isStopped = false;
  const stop = (): void => {
    if (isStopped) return;
    isStopped = true;
    observer?.disconnect();
    if (openingFrame !== null) cancelAnimationFrame(openingFrame);
    if (settlingFrame !== null) cancelAnimationFrame(settlingFrame);
    for (const event of RESETTLE_YIELD_EVENTS) {
      window.removeEventListener(event, stop);
    }
  };
  openingFrame = requestAnimationFrame(() => {
    openingFrame = null;
    if (isStopped) return;
    observer = new ResizeObserver(() => {
      const height = card.getBoundingClientRect().height;
      passes += 1;
      // The fit is a fixed point with a pass cap of its own; this only has to
      // outlast it, and stop whether or not it converges.
      if (passes > SETTLE_PASS_LIMIT) {
        stop();
        return;
      }
      settledHeight = height;
      positionChange(card);
      if (settlingFrame !== null) cancelAnimationFrame(settlingFrame);
      settlingFrame = requestAnimationFrame(() => {
        settlingFrame = null;
        if (card.getBoundingClientRect().height === settledHeight) stop();
      });
    });
    for (const event of RESETTLE_YIELD_EVENTS) {
      window.addEventListener(event, stop, { passive: true, once: true });
    }
    observer.observe(card);
    positionChange(card);
  });
  return stop;
};

/** What tells us the reader has taken the scroll position over. */
const RESETTLE_YIELD_EVENTS = ["wheel", "touchstart", "keydown"] as const;
/** Enough passes to outlast the wireframe fit, which caps itself at eight. */
const SETTLE_PASS_LIMIT = 12;

/**
 * Finds the first of a place's locations that still has somewhere to land. A
 * place can describe several locations, and one unresolvable location does not
 * make the place historical while another can still show the change in place.
 */
/**
 * Where this change's lens belongs, or why nowhere.
 *
 * The reason is carried out rather than collapsed into null because the two
 * ways a lens can find nothing lead to opposite renderings. A change the plan
 * genuinely no longer holds belongs in the historical archive; a change whose
 * article has not caught up with the reviewer's own gesture belongs exactly
 * where it always did, and drawing the archive for it puts the diff at the
 * foot of the page - the defect this distinction exists to end.
 */
const firstLiveAnchor = (
  locations: ReadonlyArray<DiffLocation>,
  isSuperseded: boolean,
): LensAnchor | { readonly missing: LiveTargetMissReason } => {
  const misses: Array<LiveTargetMissReason> = [];
  for (const location of locations) {
    const anchor = liveLensAnchor(location, { isSuperseded });
    if ("found" in anchor) {
      return { element: anchor.found, placement: anchor.placement };
    }
    misses.push(anchor.missing);
  }
  // One location still waiting on the swap is enough to make the whole place
  // premature: the archive would be drawn from an article that is about to
  // change under it.
  return {
    missing: misses.includes("plan-dom-behind")
      ? "plan-dom-behind"
      : (misses.at(0) ?? "unknown-id"),
  };
};

const LegacyDiffLensPortal = ({
  diff,
  place,
  isVisible,
  isSuperseded,
  revealKey = 0,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isVisible: boolean;
  readonly isSuperseded: boolean;
  /**
   * Bumped when the reviewer asked for this change again rather than merely
   * changed something about it. Undo is the case: the change is back and the
   * reader has to be taken to it, wherever they had scrolled to.
   */
  readonly revealKey?: number;
}) => {
  const locations = useMemo(
    () => placeLocations({ diff, place }),
    [diff, place],
  );
  const [host, setHost] = useState<HTMLElement | null>(null);
  // A reveal outlives the component that was asked for it. Undoing a rejection
  // is the case that forces this: while the change is rejected the tour renders
  // no lens at all, so the ask arrives at nothing, and the lens that will
  // honour it does not exist until the article has caught up - by which point
  // the swap has already restored the reader's old scroll position over the top
  // of it. Remembering which reveal has been honoured, rather than which one
  // this mount has seen, is what carries the ask across that gap.
  useEffect(() => {
    if (
      !shouldHonourReveal({
        revealKey,
        honoured: honouredReveal,
        hasHost: host !== null,
      }) ||
      host === null
    ) {
      return;
    }
    honouredReveal = revealKey;
    return openChangeAtReadingPosition(host);
  }, [host, revealKey]);
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
    if ("missing" in anchor) {
      // A change with nowhere in the plan to stand shows nothing at all.
      //
      // There used to be somewhere: a "Historical changes" section appended
      // after the last slide, which every way of losing an anchor fell into.
      // It was the designed answer to "the block drifted", and it was the
      // reported defect four rounds running, because a card at the foot of the
      // document is nowhere near the place it describes and the reader has no
      // way to tell a change that moved from a change that was never there.
      // Superseded locations now anchor by structural address, so a revised
      // block still has a place; what reaches here is a change the plan really
      // has no place for, and the digest and the bar are its record.
      setHost(null);
      setPresentation(undefined);
      return;
    }
    setPresentation(prosePresentationFor(anchor.element));
    const direct = locations
      .map((location) => location.newBlockId)
      .filter((blockId): blockId is string => blockId !== undefined)
      .map((blockId) => foundElement(liveBlock(blockId)))
      .filter((element): element is HTMLElement => element !== null);
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
    const stopPositioning = openChangeAtReadingPosition(container);
    return () => {
      stopPositioning();
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
  isSuperseded,
}: {
  readonly location: DiffLocation;
  readonly isAccepted: boolean;
  readonly isSuperseded: boolean;
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
    let stopPositioning: (() => void) | null = null;

    const install = (): void => {
      stopPositioning?.();
      const next = componentDiffRoot(location.view ?? "");
      if (next === null) return;
      const anchor = liveLensAnchor(locationRef.current, { isSuperseded });
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
        announcePlanDom();
      }
      document.dispatchEvent(new CustomEvent("bigplan:review-authority"));
      stopPositioning = openChangeAtReadingPosition(next);
    };

    const reinstallAfterArticleRefresh = (): void => {
      if (replacement?.isConnected === true) return;
      stopPositioning?.();
      stopPositioning = null;
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
      stopPositioning?.();
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
        announcePlanDom();
      }
    };
  }, [
    isSuperseded,
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

/**
 * The attribute the review stylesheet paints an accepted place's own blocks
 * with, so the stepper can say which place it is on without reinstating any of
 * the proposal treatment the acceptance retired.
 */
const ACCEPTED_PLACE_ATTRIBUTE = "data-review-accepted-place";

/**
 * Shows an accepted place as the plan itself: nothing is hidden and nothing is
 * inserted, so the reader meets the accepted words in the document that owns
 * them rather than inside a card still asking to be decided.
 *
 * The mark is claimed only where the plan still holds the block the place is
 * about. A removal anchors on a neighbour instead, and ringing a neighbour
 * would point the reader at content the change never touched, so that case
 * scrolls and says nothing. A replaced article detaches whatever was marked, so
 * the mark is resolved again on the article version like every other holder of
 * a plan node.
 *
 * An accepted place the plan no longer holds anywhere keeps its archived copy.
 * Reading as plan content is only possible where there is plan content to read,
 * and answering with nothing at all would lose the record of what was accepted
 * exactly where it is the only surviving evidence. Nothing renders until the
 * anchor has been resolved, so the reader never sees the proposal flash back.
 *
 * A superseded place is resolved the way a superseded lens resolves one, which
 * is what lets an acceptance survive the plan moving on. What changed is which
 * revision the block now holds, not whether the reviewer answered it.
 */
const AcceptedPlanPlace = ({
  diff,
  place,
  locations,
  isSuperseded,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly locations: ReadonlyArray<DiffLocation>;
  readonly isSuperseded: boolean;
}) => {
  const articleVersion = useArticleVersion();
  const [hasPlanPlace, setHasPlanPlace] = useState<boolean>();
  useEffect(() => {
    const anchor = firstLiveAnchor(locations, isSuperseded);
    if ("missing" in anchor) {
      // Behind the plan source is not the same as gone from it, and only the
      // second one earns the archived copy. Leaving the answer unknown keeps
      // this rendering nothing until the swap says which it was.
      setHasPlanPlace(anchor.missing === "plan-dom-behind" ? undefined : false);
      return;
    }
    setHasPlanPlace(true);
    const { element, placement } = anchor;
    requestAnimationFrame(() =>
      element.scrollIntoView({
        behavior: lensScrollBehavior(),
        block: "center",
      }),
    );
    if (placement !== "replace") return;
    // Every block the change put in the plan, not just the one the lens
    // anchored on. A change can add paragraphs beside the one it reworded -
    // an agent asked to say the same thing twice does exactly that - and a
    // ring around only the first tells the reviewer they accepted less than
    // they did.
    const marked = new Set<HTMLElement>([element]);
    for (const location of locations) {
      const blockId = location.newBlockId;
      if (blockId === undefined) continue;
      const found = foundElement(liveBlock(blockId));
      if (found !== null) marked.add(found);
    }
    for (const node of marked) node.setAttribute(ACCEPTED_PLACE_ATTRIBUTE, "");
    return () => {
      for (const node of marked) {
        node.removeAttribute(ACCEPTED_PLACE_ATTRIBUTE);
      }
    };
  }, [articleVersion, isSuperseded, locations]);
  if (hasPlanPlace !== false) return null;
  return (
    <LegacyDiffLensPortal
      diff={diff}
      place={place}
      isVisible
      isSuperseded={isSuperseded}
    />
  );
};

/** Chooses the component-owned replacement only for a migrated root. */
export const DiffLensPortal = ({
  diff,
  place,
  isVisible,
  isSuperseded,
  isAccepted,
  isShowingChanges,
  revealKey,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
  readonly isVisible: boolean;
  readonly isSuperseded: boolean;
  readonly isAccepted: boolean;
  /** True while the reviewer has asked to see an accepted change's evidence. */
  readonly isShowingChanges: boolean;
  /** Bumped when the reviewer asked to be taken back to this change. */
  readonly revealKey?: number;
}) => {
  const locations = useMemo(
    () => placeLocations({ diff, place }),
    [diff, place],
  );
  const componentLocation = useMemo(
    () => locations.find((location) => location.view !== undefined),
    [locations],
  );
  const articleVersion = useArticleVersion();
  const [componentAvailable, setComponentAvailable] = useState<boolean>();
  // Asked exactly as the replacement will ask it, superseded and all. A cheaper
  // question here than the install performs would route a change to a
  // replacement that then declines to install, leaving the stepper on a stop
  // with nothing shown.
  useEffect(() => {
    if (componentLocation === undefined) return;
    setComponentAvailable(
      "found" in liveLensAnchor(componentLocation, { isSuperseded }),
    );
  }, [articleVersion, componentLocation, isSuperseded]);
  // An accepted place is the plan, so it is shown as the plan. The evidence is
  // one control away rather than gone: asking for it puts the reviewer back on
  // the same lens an open place gets, which is what makes undoing the
  // acceptance a decision made against the same view that produced it.
  //
  // This is asked before anything else about the place, and of every place,
  // because it is the reviewer's answer rather than a rendering preference.
  // The plan having moved on since is a fact about which revision the block
  // now holds; it does not reopen a question that was already answered, and a
  // path that reached the diff around this gate would put a proposal back in
  // front of a reader whose own bar says Accepted.
  if (isVisible && isAccepted && !isShowingChanges) {
    return (
      <AcceptedPlanPlace
        key={`${place.placeId}:${articleVersion}`}
        diff={diff}
        place={place}
        locations={locations}
        isSuperseded={isSuperseded}
      />
    );
  }
  // A component change whose block still stands is shown by replacing that
  // block, whether or not the plan has since moved past it. Being superseded
  // changes what the change means, not what it is: the card is the same
  // rendering, it stands in the same place, and its drawings and tables answer
  // the reader the same way.
  //
  // The alternative - standing a replayed copy in front of the hidden block -
  // is what the archive does, and it is only honest where the block is gone.
  // In place it costs the reader the whole card: two nested "what changed"
  // frames, and an inert copy whose screen tabs and column menus cannot be
  // clicked at all. Replacing keeps the plan's one copy of every address,
  // which is the reason the archive's copy has to strip them.
  //
  // "Still stands" is a question about the block, not just about the id. A
  // structural path can come to name a different component entirely, and a
  // historical card standing over one of those hides a live component behind a
  // record of something else; `lensAnchorCandidates` holds a superseded
  // location to the kind it named, so that case reaches the archive instead.
  if (componentLocation === undefined || !isVisible) {
    return (
      <LegacyDiffLensPortal
        diff={diff}
        place={place}
        isVisible={isVisible}
        isSuperseded={isSuperseded}
        revealKey={revealKey}
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
      revealKey={revealKey}
    />
  ) : (
    <ComponentDiffReplacement
      location={componentLocation}
      isAccepted={isAccepted}
      isSuperseded={isSuperseded}
    />
  );
};
