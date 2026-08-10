// Mounts Big Plan's typed React review interaction island over the inert,
// server-rendered plan. React owns only review chrome; authored content stays
// server-rendered and readable when this island is unavailable.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { ACTIVITY_ICON } from "../../icons/lucide/activity.js";
import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { MESSAGES_SQUARE_ICON } from "../../icons/lucide/messages-square.js";
import { MAXIMIZE_2_ICON } from "../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { HOURGLASS_ICON } from "../../icons/lucide/hourglass.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { TRIANGLE_ALERT_ICON } from "../../icons/lucide/triangle-alert.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import {
  deriveAgentHealthLabel,
  deriveAgentStatus,
  deriveCurrentAgentActivity,
  type AgentStatus,
} from "../shared/agent-status.js";
import type { CommentTarget, ReviewComment } from "../shared/comment.js";
import { parseCommentMarkdownLine } from "../shared/comment-markdown.js";
import {
  reconcilePendingCancellations,
  requestIsCanceled,
} from "../shared/cancel-pending.js";
import { stackThreadPositions } from "../shared/thread-layout.js";
import {
  clearThreadOpenOverlay,
  isThreadOpen,
  setThreadOpen,
  toggleThreadOpen,
  type ThreadKind,
  type ThreadOpenState,
  type ThreadSurface,
} from "../shared/thread-open-state.js";
import {
  projectCommentThreads,
  projectRequestActivity,
  projectRequestStatus,
  requestCommentIds,
  type CommentThreadProjection,
  type ThreadGroup,
  type ThreadRuntime,
} from "../shared/thread-projection.js";
import {
  decodeAgentSnapshot as parseAgentSnapshot,
  decodeDiffLocations as parseDiffLocations,
  decodeProgress as parseProgress,
  decodeReviewSnapshot as parseSnapshot,
  decodeRuntimeSession as parseRuntimeSession,
  emptyAgentSnapshot,
  isReviewCommentValue as isComment,
  isReviewWireRecord as isRecord,
  type AgentRequest,
  type AgentResponse,
  type AgentSnapshot,
  type DiffLocation,
  type ProgressEvent,
  type RuntimeSession,
} from "../shared/review-wire.js";
import {
  AgentConnectionPanel,
  AgentHealthAlert,
} from "./agent-connection.browser.js";
import {
  AgentChangeDigest,
  AgentStatePill,
  MessageTurn,
  RequestStatusStrip,
  type MessageActivity,
  type MessageSurface,
} from "./agent-message.browser.js";
import { Icon } from "./icon.browser.js";
import { AlertDialog, Badge, Button, Card, Textarea } from "./ui.browser.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT = 4000;
const LONG_COMMENT = 180;
const REQUEST_TIMEOUT_MS = 10_000;
const PROSE_KINDS = new Set(["heading", "paragraph", "list", "blockquote"]);
const TABLE_PRECISION_KINDS = new Set([
  "table-cell",
  "table-column",
  "table-row",
]);

type PendingDelete =
  | { readonly kind: "comment"; readonly comment: ReviewComment }
  | { readonly kind: "queued"; readonly comment: ReviewComment }
  | { readonly kind: "all"; readonly count: number };

type RuntimeIdentity = {
  readonly planId: string;
  readonly sessionId: string;
  readonly token: string;
};

type ComposeState = {
  readonly target: CommentTarget;
  readonly top: number;
  readonly left: number;
};

type SelectionControlState = {
  readonly target: Extract<CommentTarget, { readonly type: "selection" }>;
  readonly top: number;
  readonly left: number;
};

type FeedbackTab = "comments" | "chat" | "agent";
const LIVE_FEEDBACK_TABS: ReadonlyArray<FeedbackTab> = [
  "comments",
  "chat",
  "agent",
];
const STATIC_FEEDBACK_TABS: ReadonlyArray<FeedbackTab> = ["comments", "chat"];
const FEEDBACK_TAB_CLASS =
  "relative inline-flex min-h-8 min-w-0 cursor-pointer items-center justify-start gap-1.5 rounded-none border-0 bg-transparent px-2 py-1.5 text-xs font-semibold text-muted after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-transparent after:content-[''] hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-accent aria-selected:text-ink aria-selected:after:bg-accent max-sm:text-2xs [&>svg]:size-3.5 [&>svg]:shrink-0 [&>span]:min-w-5 [&>span]:justify-center [&>span]:bg-[var(--annotation-bg)] [&>span]:text-2xs [&>span]:text-[var(--annotation-c)]";
const WIDE_QUERY = "(min-width: 80rem)";
const MODIFIER_SHORTCUT = /Mac|iPhone|iPad/u.test(navigator.platform)
  ? "⌘+Enter"
  : "Ctrl+Enter";
type StagedCardSurface = "rail" | "thread";
type SelectionTarget = Extract<CommentTarget, { readonly type: "selection" }>;

type FloatingRect = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

type FloatingPosition = {
  readonly top: number;
  readonly left: number;
};

const rootElement = document.documentElement;

const DelayedTooltip = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{
    readonly top: number;
    readonly left: number;
  } | null>(null);
  const hide = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPosition(null);
  };
  const show = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const center = rect.left + rect.width / 2;
      const edge = Math.min(96, window.innerWidth / 2);
      setPosition({
        top: rect.top - 8,
        left: Math.min(window.innerWidth - edge, Math.max(edge, center)),
      });
      timerRef.current = null;
    }, 1_000);
  };
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {position === null
        ? null
        : createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[2147483647] w-max max-w-44 -translate-x-1/2 -translate-y-full rounded-sm bg-[var(--ink-c)] px-2 py-1 text-center text-2xs font-semibold leading-[1.35] text-[var(--bg)] shadow-floating"
              style={{ top: position.top, left: position.left }}
            >
              {label}
            </span>,
            document.body,
          )}
    </span>
  );
};

const ThreadIconButton = ({
  label,
  icon,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly tone?: "danger" | "neutral" | "positive";
}) => {
  const hoverClass =
    tone === "danger"
      ? "hover:border-danger hover:bg-[var(--callout-danger-bg)] hover:text-danger hover:shadow-raised focus-visible:border-danger focus-visible:bg-[var(--callout-danger-bg)] focus-visible:text-danger"
      : tone === "positive"
        ? "hover:border-accent hover:bg-accent-wash hover:text-accent hover:shadow-raised focus-visible:border-accent focus-visible:bg-accent-wash focus-visible:text-accent"
        : "hover:bg-surface hover:text-ink hover:shadow-raised focus-visible:bg-surface focus-visible:text-ink";
  return (
    <DelayedTooltip label={label}>
      <button
        type="button"
        className={`inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent p-0 leading-none text-muted transition-[color,background-color,border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent active:inset-shadow-pressed disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:text-subtle disabled:shadow-none [&>svg]:size-3.5 ${hoverClass}`}
        aria-label={label}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.();
        }}
      >
        <Icon icon={icon} />
      </button>
    </DelayedTooltip>
  );
};

/** Finds the initial viewport slot for a document-anchored composer. */
const floatingComposerPosition = ({
  preferred,
  width,
  height,
  obstacles,
}: {
  readonly preferred: FloatingPosition;
  readonly width: number;
  readonly height: number;
  readonly obstacles: ReadonlyArray<FloatingRect>;
}): FloatingPosition => {
  const edge = 24;
  const gap = 12;
  const left = Math.max(
    edge,
    Math.min(preferred.left, window.innerWidth - width - edge),
  );
  const clampTop = (top: number) =>
    Math.max(edge, Math.min(top, window.innerHeight - height - edge));
  const candidates = [
    clampTop(preferred.top),
    ...obstacles.flatMap((obstacle) => [
      clampTop(obstacle.bottom + gap),
      clampTop(obstacle.top - height - gap),
    ]),
  ];
  const score = (top: number) => {
    const right = left + width;
    const bottom = top + height;
    return obstacles.reduce((total, obstacle) => {
      const overlapWidth = Math.max(
        0,
        Math.min(right, obstacle.right + gap) -
          Math.max(left, obstacle.left - gap),
      );
      const overlapHeight = Math.max(
        0,
        Math.min(bottom, obstacle.bottom + gap) -
          Math.max(top, obstacle.top - gap),
      );
      return total + overlapWidth * overlapHeight;
    }, 0);
  };
  const top = candidates.reduce((best, candidate) => {
    const candidateScore = score(candidate);
    const bestScore = score(best);
    if (candidateScore !== bestScore)
      return candidateScore < bestScore ? candidate : best;
    return Math.abs(candidate - preferred.top) < Math.abs(best - preferred.top)
      ? candidate
      : best;
  });
  return { top, left };
};

/** Formats the compact freshness label used by contextual thread cards. */
const threadTime = (createdAt: string): string => {
  const elapsed = Math.max(0, Date.now() - Date.parse(createdAt));
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000)
    return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 2_592_000_000)
    return `${Math.floor(elapsed / 86_400_000)}d ago`;
  if (elapsed < 31_536_000_000)
    return `${Math.floor(elapsed / 2_592_000_000)}mo ago`;
  return `${Math.floor(elapsed / 31_536_000_000)}y ago`;
};

const runtimeIdentity = (): RuntimeIdentity | null => {
  const planId = rootElement.getAttribute("data-plan-id") ?? "";
  const sessionId = rootElement.getAttribute("data-review-session") ?? "";
  const token = rootElement.getAttribute("data-review-token") ?? "";
  return planId === "" || sessionId === "" || token === ""
    ? null
    : { planId, sessionId, token };
};

const bootstrapSourceRevision = (): string => {
  try {
    const value: unknown = JSON.parse(
      rootElement.getAttribute("data-review-bootstrap") ?? "{}",
    );
    return isRecord(value) && typeof value.sourceRevision === "string"
      ? value.sourceRevision
      : "";
  } catch {
    return "";
  }
};

const localStorageKey = (planId: string): string =>
  `big-plan:review:drafts:${planId}`;

const readLocalDrafts = (planId: string): ReadonlyArray<ReviewComment> => {
  try {
    const raw = localStorage.getItem(localStorageKey(planId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isComment) : [];
  } catch {
    return [];
  }
};

const writeLocalDrafts = (
  planId: string,
  drafts: ReadonlyArray<ReviewComment>,
): void => {
  try {
    localStorage.setItem(localStorageKey(planId), JSON.stringify(drafts));
  } catch {
    // Offline browser persistence is best effort; visible status stays honest.
  }
};

const requestJson = async ({
  path,
  identity,
  method = "GET",
  body,
}: {
  readonly path: string;
  readonly identity: RuntimeIdentity;
  readonly method?: "GET" | "PUT" | "POST";
  readonly body?: unknown;
}): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(path, {
      method,
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        [TOKEN_HEADER]: identity.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(
        `Review runtime refused the request (${response.status})`,
      );
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Review runtime request timed out.", { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

const randomId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

const blockIdentity = (block: HTMLElement) => ({
  blockId: block.dataset.blockId ?? "",
  kind: block.dataset.blockKind ?? "block",
  label: block.dataset.blockLabel ?? "This block",
  ...(block.dataset.blockSection === undefined
    ? {}
    : { section: block.dataset.blockSection }),
});

const targetForBlock = (
  block: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> => ({
  type: "block",
  ...blockIdentity(block),
});

const targetForSlide = (
  slide: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null => {
  const firstBlock = slide.querySelector<HTMLElement>("[data-block-id]");
  if (firstBlock === null) {
    return null;
  }
  return {
    type: "block",
    ...blockIdentity(firstBlock),
    kind: "slide",
    label:
      firstBlock.dataset.blockSection ??
      firstBlock.dataset.blockLabel ??
      "Slide",
  };
};

const targetForReviewContainer = (
  container: HTMLElement,
): Extract<CommentTarget, { readonly type: "block" }> | null =>
  container.matches("[data-quick-summary]")
    ? targetForBlock(container)
    : targetForSlide(container);

const targetLabel = (
  target: CommentTarget,
  includeSlideReference = false,
): string => {
  let label: string;
  if (target.type === "document") label = "Whole plan";
  else if (target.type === "selection")
    label = `Selected text in ${target.label}`;
  else if (target.kind === "table" || target.kind === "data-table")
    label = [target.section, "Table"].filter(Boolean).join(" · ");
  else label = target.label;

  if (!includeSlideReference || target.type === "document") return label;
  const reviewContainer = targetElement(target)?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  if (reviewContainer?.matches("[data-quick-summary]") === true) {
    return "Quick summary";
  }
  const kicker = reviewContainer
    ?.querySelector<HTMLElement>("[data-slide-kicker]")
    ?.textContent?.trim();
  const slideReference = kicker?.match(/^(\d+(?:\.\d+)*)\s*\//u)?.[1];
  const slideTitle = reviewContainer
    ?.querySelector<HTMLElement>(
      "[data-collapse-header] h2, [data-collapse-header] h3",
    )
    ?.textContent?.trim();
  if (slideTitle === undefined || slideTitle === "") return label;
  return slideReference === undefined
    ? slideTitle
    : `${slideReference} · ${slideTitle}`;
};

const parentElementFor = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement;

const SELECTION_BLOCK_SELECTOR =
  '[data-block-id]:not([data-block-kind="part"])';

const selectionBoundaryBlock = ({
  container,
  offset,
  edge,
}: {
  readonly container: Node;
  readonly offset: number;
  readonly edge: "start" | "end";
}): HTMLElement | null => {
  const direct = parentElementFor(container)?.closest<HTMLElement>(
    SELECTION_BLOCK_SELECTOR,
  );
  if (direct !== null && direct !== undefined) return direct;
  if (!(container instanceof Element) || container.childNodes.length === 0) {
    return null;
  }
  const childIndex =
    edge === "start"
      ? Math.min(offset, container.childNodes.length - 1)
      : Math.max(0, Math.min(offset - 1, container.childNodes.length - 1));
  const child = container.childNodes[childIndex];
  if (child === undefined) return null;
  const childElement = parentElementFor(child);
  if (childElement?.matches(SELECTION_BLOCK_SELECTOR) === true) {
    return childElement as HTMLElement;
  }
  const descendants = Array.from(
    childElement?.querySelectorAll<HTMLElement>(SELECTION_BLOCK_SELECTOR) ?? [],
  );
  return edge === "start"
    ? (descendants[0] ?? null)
    : (descendants.at(-1) ?? null);
};

const selectionOffsetWithin = ({
  block,
  container,
  offset,
  edge,
}: {
  readonly block: HTMLElement;
  readonly container: Node;
  readonly offset: number;
  readonly edge: "start" | "end";
}): number => {
  if (block !== container && !block.contains(container)) {
    return edge === "start" ? 0 : (block.textContent?.length ?? 0);
  }
  const before = document.createRange();
  before.selectNodeContents(block);
  if (edge === "start") before.setEnd(container, offset);
  else before.setEnd(container, offset);
  return before.toString().length;
};

const selectionControlState = (): SelectionControlState | null => {
  const selection = window.getSelection();
  if (
    selection === null ||
    selection.rangeCount !== 1 ||
    selection.isCollapsed
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startBlock = selectionBoundaryBlock({
    container: range.startContainer,
    offset: range.startOffset,
    edge: "start",
  });
  const endBlock = selectionBoundaryBlock({
    container: range.endContainer,
    offset: range.endOffset,
    edge: "end",
  });
  const startReviewContainer = startBlock?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const endReviewContainer = endBlock?.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  if (
    startBlock == null ||
    endBlock == null ||
    (startBlock !== endBlock &&
      (startReviewContainer == null ||
        startReviewContainer !== endReviewContainer)) ||
    startBlock.closest("#big-plan-review-root") !== null
  ) {
    return null;
  }
  const quote = selection.toString();
  if (quote.trim() === "" || quote.length > 400) return null;
  const start = selectionOffsetWithin({
    block: startBlock,
    container: range.startContainer,
    offset: range.startOffset,
    edge: "start",
  });
  const end = selectionOffsetWithin({
    block: endBlock,
    container: range.endContainer,
    offset: range.endOffset,
    edge: "end",
  });
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    target: {
      type: "selection",
      ...blockIdentity(startBlock),
      ...(startBlock === endBlock
        ? {}
        : { endBlockId: endBlock.dataset.blockId ?? "" }),
      start,
      end,
      quote,
    },
    top: Math.max(8, rect.top - 44),
    left: Math.max(8, Math.min(window.innerWidth - 132, rect.left)),
  };
};

const targetElement = (target: CommentTarget): HTMLElement | null => {
  if (target.type === "document") return document.querySelector("main");
  const block = document.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(target.blockId)}"]`,
  );
  return target.type === "block" && target.kind === "slide"
    ? (block?.closest<HTMLElement>("[data-slide]") ?? block)
    : block;
};

const targetAssociationElements = (
  target: CommentTarget,
): ReadonlySet<HTMLElement> => {
  const element = targetElement(target);
  if (element === null) return new Set();
  const owningContainer = element.closest<HTMLElement>(
    "[data-slide], [data-quick-summary]",
  );
  const elements = new Set<HTMLElement>();
  if (
    target.type !== "selection" &&
    !(element.matches("[data-authored-prose]") && owningContainer !== null)
  ) {
    elements.add(element);
  }
  if (owningContainer !== null) elements.add(owningContainer);
  return elements;
};

const targetAddress = (target: CommentTarget): string => {
  if (target.type === "document") return "document";
  if (target.type === "selection") {
    return `selection:${target.blockId}:${target.start}:${target.endBlockId ?? target.blockId}:${target.end}`;
  }
  return `block:${target.blockId}`;
};

type HighlightRegistry = {
  set(name: string, value: unknown): void;
  delete(name: string): void;
};

const selectionRange = (
  target: Extract<CommentTarget, { readonly type: "selection" }>,
): Range | null => {
  const startBlock = targetElement(target);
  const endBlock =
    target.endBlockId === undefined
      ? startBlock
      : document.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(target.endBlockId)}"]`,
        );
  if (startBlock === null || endBlock === null) return null;
  const textPoint = (
    block: HTMLElement,
    targetOffset: number,
  ): { readonly node: Text; readonly offset: number } | null => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let last: Text | null = null;
    let node = walker.nextNode();
    while (node !== null) {
      if (!(node instanceof Text)) {
        node = walker.nextNode();
        continue;
      }
      last = node;
      const length = node.data.length;
      if (targetOffset <= consumed + length) {
        return { node, offset: Math.max(0, targetOffset - consumed) };
      }
      consumed += length;
      node = walker.nextNode();
    }
    return last === null ? null : { node: last, offset: last.data.length };
  };
  const start = textPoint(startBlock, target.start);
  const end = textPoint(endBlock, target.end);
  if (start === null || end === null) return null;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
};

const setSelectionHighlights = (
  targets: ReadonlyArray<SelectionTarget>,
  activeTarget: SelectionTarget | null,
): void => {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  registry?.delete("big-plan-review-selection");
  registry?.delete("big-plan-review-selection-active");
  const HighlightClass = (
    window as unknown as {
      Highlight?: new (...ranges: ReadonlyArray<Range>) => unknown;
    }
  ).Highlight;
  if (registry === undefined || HighlightClass === undefined) return;
  const ranges = targets
    .map((target) => selectionRange(target))
    .filter((range): range is Range => range !== null);
  if (ranges.length > 0)
    registry.set("big-plan-review-selection", new HighlightClass(...ranges));
  const activeRange =
    activeTarget === null ? null : selectionRange(activeTarget);
  if (activeRange !== null)
    registry.set(
      "big-plan-review-selection-active",
      new HighlightClass(activeRange),
    );
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";

const inlineMarkdown = (source: string): ReadonlyArray<ReactNode> =>
  parseCommentMarkdownLine(source).map((token, index) => {
    const key = `${index}-${token.value}`;
    if (token.type === "code") return <code key={key}>{token.value}</code>;
    if (token.type === "strong")
      return <strong key={key}>{token.value}</strong>;
    if (token.type === "emphasis") return <em key={key}>{token.value}</em>;
    return token.value;
  });

const MarkdownBody = ({
  body,
  className = "",
}: {
  readonly body: string;
  readonly className?: string;
}) => (
  <div className={className}>
    {body.split(/\n{2,}/u).map((paragraph, index) => (
      <p key={`${index}-${paragraph}`}>
        {paragraph
          .split("\n")
          .flatMap((line, lineIndex) => [
            ...(lineIndex === 0 ? [] : [<br key={`break-${lineIndex}`} />]),
            ...inlineMarkdown(line),
          ])}
      </p>
    ))}
  </div>
);

/** Finds chrome owned by one block without borrowing controls from a nested block. */
const ownedDescendant = (
  block: HTMLElement,
  selector: string,
): HTMLElement | null =>
  Array.from(block.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.closest<HTMLElement>("[data-block-id]") === block,
  ) ?? null;

const useBlockHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly block: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mounted = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-block-id]:not([data-block-kind="part"])',
      ),
    )
      .filter(
        (block) =>
          !PROSE_KINDS.has(block.dataset.blockKind ?? "") &&
          !TABLE_PRECISION_KINDS.has(block.dataset.blockKind ?? "") &&
          block.closest("[data-quick-summary]") === null,
      )
      .map((block) => {
        const host = document.createElement("span");
        if (
          block.dataset.blockKind === "data-table" ||
          block.dataset.blockKind === "table"
        ) {
          host.dataset.reviewTableHost = "";
          (
            ownedDescendant(block, "[data-table-scroll-container]") ?? block
          ).append(host);
        } else {
          host.dataset.reviewAnchorHost = "";
          const copyControl = ownedDescendant(
            block,
            "[data-copy-source], [data-copy-code]",
          );
          const actionGroup = ownedDescendant(
            block,
            ".figure-action-group, .figure-control-bar",
          );
          const inlineHeader = ownedDescendant(
            block,
            ".file-tree-header, .callout-header",
          );
          const overlayHeader = ownedDescendant(
            block,
            ".decision-zone-question",
          );
          if (copyControl !== null) {
            host.dataset.reviewToolbarHost = "";
            copyControl.before(host);
          } else if (actionGroup !== null) {
            host.dataset.reviewToolbarHost = "";
            actionGroup.prepend(host);
          } else if (inlineHeader !== null) {
            host.dataset.reviewToolbarHost = "";
            host.dataset.reviewToolbarInline = "";
            inlineHeader.append(host);
          } else if (overlayHeader !== null) {
            host.dataset.reviewToolbarHost = "";
            host.dataset.reviewToolbarOverlay = "";
            overlayHeader.append(host);
          } else {
            block.append(host);
          }
        }
        return { block, host };
      });
    setHosts(mounted);
    return () => mounted.forEach(({ host }) => host.remove());
  }, []);
  return hosts;
};

const useReviewContainerHosts = () => {
  const [hosts, setHosts] = useState<
    ReadonlyArray<{
      readonly container: HTMLElement;
      readonly host: HTMLSpanElement;
    }>
  >([]);
  useEffect(() => {
    const mounted = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-slide], [data-quick-summary]",
      ),
    )
      .filter(
        (container) =>
          !container.matches("[data-quick-summary]") ||
          container.closest("[data-slide]") === null,
      )
      .map((container) => {
        const host = document.createElement("span");
        host.dataset.reviewSlideHost = "";
        const collapseHeader = container.querySelector<HTMLElement>(
          ":scope > [data-collapse-header]",
        );
        if (collapseHeader === null) container.append(host);
        else collapseHeader.prepend(host);
        container.dataset.reviewSlideSelectable = "";
        return { container, host };
      });
    setHosts(mounted);
    return () =>
      mounted.forEach(({ container, host }) => {
        host.remove();
        delete container.dataset.reviewSlideSelectable;
        delete container.dataset.reviewSlideSelected;
      });
  }, []);
  return hosts;
};

const useFeedbackHost = (): HTMLSpanElement | null => {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    const settings = document.querySelector<HTMLElement>(
      "[data-preferences-control]",
    );
    if (settings === null || settings.parentElement === null) return;
    const legacyControl = settings.parentElement.querySelector<HTMLElement>(
      "[data-comment-draft-control]",
    );
    if (legacyControl !== null) legacyControl.hidden = true;
    const next = document.createElement("span");
    next.dataset.reviewFeedbackHost = "";
    settings.before(next);
    setHost(next);
    return () => {
      next.remove();
      if (legacyControl !== null) legacyControl.hidden = false;
    };
  }, []);

  return host;
};

const useWide = (): boolean => {
  const [isWide, setIsWide] = useState(
    () => window.matchMedia(WIDE_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setIsWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isWide;
};

const useInlineComposeHost = (
  compose: ComposeState | null,
  isOpen: boolean,
): HTMLDivElement | null => {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const isNarrow = !useWide();
  useEffect(() => {
    if ((!isOpen && !isNarrow) || compose === null) {
      setHost(null);
      return;
    }
    const anchor = targetElement(compose.target);
    if (anchor === null) {
      setHost(null);
      return;
    }
    const next = document.createElement("div");
    next.dataset.reviewComposeInline = "";
    anchor.after(next);
    setHost(next);
    return () => {
      next.remove();
    };
  }, [compose, isNarrow, isOpen]);
  return host;
};

const useThreadHosts = (
  comments: ReadonlyArray<ReviewComment>,
  isOpen: boolean,
): ReadonlyMap<string, HTMLDivElement> => {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map(),
  );
  const isWide = useWide();

  useEffect(() => {
    if (!isWide) {
      setHosts(new Map());
      return;
    }
    const mounted = new Map<string, HTMLDivElement>();
    for (const comment of comments) {
      const anchor = targetElement(comment.target);
      if (anchor === null) continue;
      const host = document.createElement("div");
      host.dataset.reviewThreadFor = comment.id;
      host.dataset.reviewThreadSide = "";
      document.body.append(host);
      mounted.set(comment.id, host);
    }
    const position = () => {
      const viewportWidth = document.documentElement.clientWidth;
      const edge = 24;
      const feedbackRailWidth = isOpen ? Math.min(22 * 16, viewportWidth) : 0;
      const threadTopInset = 12;
      const threadWidth = 17 * 16;
      const positionItems: Array<{
        readonly id: string;
        readonly desiredTop: number;
        readonly height: number;
      }> = [];
      const anchorRects = new Map<string, DOMRect>();
      for (const comment of comments) {
        const host = mounted.get(comment.id);
        const target = targetElement(comment.target);
        if (host === undefined || target === null) continue;
        const anchor =
          target.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
          target;
        const anchorRect = anchor.getBoundingClientRect();
        const targetRect =
          comment.target.type === "selection"
            ? selectionRange(comment.target)?.getBoundingClientRect()
            : null;
        const cardHeight = Math.max(
          1,
          host.firstElementChild?.getBoundingClientRect().height ?? 1,
        );
        const desiredTop =
          (targetRect?.top ?? anchorRect.top) + window.scrollY + threadTopInset;
        positionItems.push({
          id: comment.id,
          desiredTop,
          height: cardHeight,
        });
        anchorRects.set(comment.id, anchorRect);
      }
      for (const { id, top } of stackThreadPositions({
        items: positionItems,
        gap: 8,
      })) {
        const host = mounted.get(id);
        const anchorRect = anchorRects.get(id);
        if (host === undefined || anchorRect === undefined) continue;
        host.style.top = `${top}px`;
        host.style.left = `${Math.max(
          edge + window.scrollX,
          Math.min(
            anchorRect.right + window.scrollX - 12,
            window.scrollX +
              viewportWidth -
              feedbackRailWidth -
              threadWidth -
              edge,
          ),
        )}px`;
      }
    };
    const frame = requestAnimationFrame(position);
    const observer = new ResizeObserver(position);
    for (const host of mounted.values()) observer.observe(host);
    window.addEventListener("resize", position, { passive: true });
    setHosts(mounted);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", position);
      for (const host of mounted.values()) host.remove();
    };
  }, [comments, isOpen, isWide]);

  return hosts;
};

const CommentComposer = ({
  compose,
  body,
  inline,
  submitRightAway,
  onCancel,
  onBodyChange,
  onSave,
  onSubmitRightAwayChange,
}: {
  readonly compose: ComposeState;
  readonly body: string;
  readonly inline: boolean;
  readonly submitRightAway: boolean;
  readonly onCancel: () => void;
  readonly onBodyChange: (body: string) => void;
  readonly onSave: (body: string, submitRightAway: boolean) => void;
  readonly onSubmitRightAwayChange: (submitRightAway: boolean) => void;
}) => {
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    top: compose.top,
    left: compose.left,
  });
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (inline) return;
    const frame = requestAnimationFrame(() => {
      const rect = composerRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const obstacles = Array.from(
        document.querySelectorAll<HTMLElement>("[data-review-thread-side]"),
        (node) => node.getBoundingClientRect(),
      ).filter((obstacle) => obstacle.width > 0 && obstacle.height > 0);
      const next = floatingComposerPosition({
        preferred: {
          top: compose.top - window.scrollY,
          left: compose.left - window.scrollX,
        },
        width: rect.width,
        height: rect.height,
        obstacles,
      });
      setFloatingPosition({
        top: next.top + window.scrollY,
        left: next.left + window.scrollX,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [compose.left, compose.top, inline]);
  const save = () => body.trim() !== "" && onSave(body.trim(), submitRightAway);
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };
  const style: CSSProperties = {
    ...(inline
      ? {}
      : {
          top: `${floatingPosition.top}px`,
          left: `${floatingPosition.left}px`,
        }),
  };
  return (
    <Card
      ref={composerRef}
      className={
        inline
          ? `review-comment-composer-inline relative z-auto mb-6 w-full max-w-lg border border-edge bg-paper! p-3 text-ink shadow-floating ${compose.target.type === "block" && compose.target.kind === "slide" ? "-mt-4" : "mt-2"}`
          : "review-comment-composer-floating absolute z-30 w-[min(17rem,calc(100vw-2rem))] border border-edge bg-paper! p-3 text-ink shadow-floating"
      }
      style={style}
      role="dialog"
      aria-label={`Comment on ${targetLabel(compose.target)}`}
      data-review-associated={
        compose.target.type === "selection" ? "true" : undefined
      }
    >
      <p className="review-compose-title m-0 mb-2 text-xs font-semibold text-muted">
        Add a comment
      </p>
      <Textarea
        ref={inputRef}
        aria-label="Add a comment"
        className="bg-input!"
        value={body}
        maxLength={BODY_LIMIT}
        placeholder="What should the agent change here?"
        onChange={(event) => onBodyChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <p className="review-compose-hint mt-1 mb-0 text-2xs text-subtle">
        Escape cancels · {MODIFIER_SHORTCUT} adds
      </p>
      <div className="mt-2 block">
        <button
          type="button"
          className="group inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          role="switch"
          aria-checked={submitRightAway}
          onClick={() => onSubmitRightAwayChange(!submitRightAway)}
        >
          <span
            className="relative h-5 w-8 rounded-full border border-edge bg-surface inset-shadow-well after:absolute after:top-1/2 after:left-1 after:size-3 after:-translate-y-1/2 after:rounded-full after:bg-muted after:transition-transform group-aria-checked:border-accent group-aria-checked:bg-accent-soft group-aria-checked:after:translate-x-3 group-aria-checked:after:bg-accent"
            aria-hidden="true"
          />
          Submit right away
        </button>
        <div className="mt-2 flex items-center justify-end gap-1">
          <Button variant="outline" size="compact" onClick={onCancel}>
            Cancel
          </Button>
          <span className="group relative inline-flex">
            <Button size="micro" disabled={body.trim() === ""} onClick={save}>
              {submitRightAway ? "Submit Now" : "Add Comment"}
            </Button>
            <span
              role="tooltip"
              className="invisible pointer-events-none absolute top-[calc(100%+0.35rem)] right-0 z-50 w-max rounded-sm bg-[var(--ink-c)] px-2 py-1 text-2xs font-medium text-[var(--bg)] opacity-0 transition-[opacity,visibility] duration-0 group-hover:visible group-hover:opacity-100 group-hover:delay-1000 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:delay-1000"
            >
              {MODIFIER_SHORTCUT}
            </span>
          </span>
        </div>
      </div>
    </Card>
  );
};

const CommentCardHeader = ({
  target,
  surface,
  metaClassName,
  targetClassName,
  actionsClassName,
  onJump,
  onHeaderClick,
  onTargetClick,
  children,
}: {
  readonly target: CommentTarget;
  readonly surface: StagedCardSurface;
  readonly metaClassName: string;
  readonly targetClassName: string;
  readonly actionsClassName: string;
  readonly onJump: () => void;
  readonly onHeaderClick?: () => void;
  readonly onTargetClick?: () => void;
  readonly children: ReactNode;
}) => (
  <div
    className={`review-comment-meta ${metaClassName} flex min-w-0 items-center gap-2 ${surface === "thread" ? "-mx-3 -mt-3 mb-3 rounded-t-lg border-b border-edge bg-comment-toolbar!" : "border-b border-edge bg-comment-toolbar"} ${onHeaderClick === undefined ? "" : "cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--comment-toolbar-c)_94%,var(--ink-c))]!"}`}
    style={{ padding: "3px 5px" }}
    onClick={onHeaderClick}
  >
    <button
      type="button"
      className={`${targetClassName} min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 pl-0.5 text-left leading-normal focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${onHeaderClick === undefined ? "hover:underline" : ""} ${surface === "thread" ? "text-2xs font-medium text-subtle" : "text-xs font-semibold text-muted"}`}
      onClick={(event) => {
        event.stopPropagation();
        (onTargetClick ?? onHeaderClick ?? onJump)();
      }}
      title={
        onTargetClick === undefined && onHeaderClick !== undefined
          ? "Minimize comment"
          : `Go to ${targetLabel(target, true)}`
      }
    >
      {targetLabel(target, true)}
    </button>
    <div
      className={`${actionsClassName} ml-auto flex shrink-0 items-center gap-1`}
    >
      {children}
    </div>
  </div>
);

const ContextualCommentSummary = ({
  className = "",
  status,
  statusIcon,
  statusSpinner = false,
  statusTone = "secondary",
  statusClassName = "",
  body,
  associated,
  onExpand,
  onAssociate,
  threadGroup,
  commentId,
  children,
}: {
  readonly className?: string;
  readonly status: string;
  readonly statusIcon?: LucideIcon;
  readonly statusSpinner?: boolean;
  readonly statusTone?: "annotation" | "secondary";
  readonly statusClassName?: string;
  readonly body: string;
  readonly associated: boolean;
  readonly onExpand: () => void;
  readonly onAssociate: (active: boolean) => void;
  readonly threadGroup?: string;
  readonly commentId?: string;
  readonly children: ReactNode;
}) => (
  <Card
    className={`review-contextual-summary group/contextual mt-2 flex w-full max-w-[17rem] items-center gap-2 border border-edge bg-raised! transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted ${className}`}
    density="dense"
    elevation="floating"
    onPointerEnter={() => onAssociate(true)}
    onPointerLeave={(event) => {
      if (!event.currentTarget.contains(document.activeElement))
        onAssociate(false);
    }}
    onFocus={() => onAssociate(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        onAssociate(false);
    }}
    data-review-comment-ui=""
    data-review-associated={associated ? "true" : undefined}
    data-review-sent-thread={threadGroup}
    data-review-comment-id={commentId}
  >
    {statusSpinner ? (
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--callout-note-bg)] px-1.5 py-0.5 text-2xs font-semibold text-[var(--callout-note-c)] ${statusClassName}`}
        aria-label={status}
      >
        <span
          className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none"
          aria-hidden="true"
        />
        {status}
      </span>
    ) : statusIcon === undefined ? (
      <Badge
        size="compact"
        shape="badge"
        tone={statusTone}
        className={`shrink-0 leading-normal tracking-caps ${statusClassName}`}
      >
        {status.toUpperCase()}
      </Badge>
    ) : (
      <span
        role="img"
        aria-label={status}
        className="inline-flex size-5 shrink-0 items-center justify-center text-[var(--callout-warning-c)] [&>svg]:size-3.5"
      >
        <Icon icon={statusIcon} />
      </span>
    )}
    <button
      type="button"
      className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-xs text-ink hover:underline hover:underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      aria-label={`Expand comment: ${body}`}
      aria-expanded="false"
      onClick={onExpand}
    >
      {body}
    </button>
    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/contextual:opacity-100 group-focus-within/contextual:opacity-100">
      {children}
    </div>
  </Card>
);

const StagedCard = ({
  comment,
  surface,
  associated,
  collapsed,
  expanded,
  onCollapse,
  onExpandBody,
  onMinimizeBody,
  onUpdate,
  onDelete,
  onJump,
  onSubmit,
  onAssociate,
}: {
  readonly comment: ReviewComment;
  readonly surface: StagedCardSurface;
  readonly associated: boolean;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly onCollapse?: () => void;
  readonly onExpandBody: () => void;
  readonly onMinimizeBody: () => void;
  readonly onUpdate: (body: string) => void;
  readonly onDelete: () => void;
  readonly onJump: () => void;
  readonly onSubmit: () => void;
  readonly onAssociate: (target: CommentTarget | null) => void;
}) => {
  const setAssociated = (active: boolean) => {
    onAssociate(active ? comment.target : null);
  };
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const saveEdit = () => {
    const nextBody = editBody.trim();
    if (nextBody === "") return;
    onUpdate(nextBody);
    setIsEditing(false);
  };
  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);
  if (collapsed) {
    return (
      <ContextualCommentSummary
        className={`review-staged-collapsed-${surface}`}
        status="Staged"
        statusTone="annotation"
        body={comment.body}
        associated={associated}
        onExpand={() => onCollapse?.()}
        onAssociate={setAssociated}
      >
        <ThreadIconButton
          label="Delete staged comment"
          icon={TRASH_2_ICON}
          onClick={onDelete}
          tone="danger"
        />
      </ContextualCommentSummary>
    );
  }
  const long = comment.body.length > LONG_COMMENT;
  const visibleBody =
    long && !expanded
      ? `${comment.body.slice(0, LONG_COMMENT).trimEnd()}…`
      : comment.body;
  if (surface === "rail") {
    return (
      <Card
        className="review-staged-card w-full max-w-none overflow-hidden border border-edge bg-comment-body! p-0! shadow-raised transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted"
        density="dense"
        elevation="none"
        onPointerEnter={() => setAssociated(true)}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement))
            setAssociated(false);
        }}
        onFocus={() => setAssociated(true)}
        onBlur={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setAssociated(false);
        }}
        data-review-comment-ui=""
        data-review-associated={associated ? "true" : undefined}
        data-review-surface="rail"
      >
        <CommentCardHeader
          target={comment.target}
          surface="rail"
          metaClassName="review-staged-meta"
          targetClassName="review-staged-target"
          actionsClassName="review-staged-actions"
          onJump={onJump}
        >
          {long && expanded ? (
            <ThreadIconButton
              label="Minimize comment"
              icon={MINIMIZE_2_ICON}
              onClick={onMinimizeBody}
            />
          ) : null}
          <ThreadIconButton
            label="Edit staged comment"
            icon={PENCIL_ICON}
            onClick={() => {
              setEditBody(comment.body);
              setIsEditing(true);
            }}
          />
          <ThreadIconButton
            label="Delete staged comment"
            icon={TRASH_2_ICON}
            onClick={onDelete}
            tone="danger"
          />
        </CommentCardHeader>
        {isEditing ? (
          <div className="p-3">
            <Textarea
              ref={editRef}
              className="bg-input!"
              aria-label="Edit comment"
              value={editBody}
              maxLength={BODY_LIMIT}
              onChange={(event) => setEditBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditBody(comment.body);
                  setIsEditing(false);
                } else if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  saveEdit();
                }
              }}
            />
            <p className="mt-1 text-2xs text-muted">
              Escape cancels · {MODIFIER_SHORTCUT} saves
            </p>
            <div className="mt-2 flex justify-end gap-1">
              <Button
                variant="outline"
                size="compact"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                size="micro"
                disabled={editBody.trim() === ""}
                onClick={saveEdit}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-3">
            <MarkdownBody
              body={visibleBody}
              className={`review-staged-body [overflow-wrap:anywhere] text-sm text-ink [&_p]:m-0 [&_p+p]:mt-2 ${expanded ? "" : "line-clamp-3"}`}
            />
            {long && !expanded ? (
              <button
                type="button"
                className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                onClick={onExpandBody}
              >
                … more
              </button>
            ) : null}
            <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-xs text-muted">
              <time dateTime={comment.createdAt}>
                {threadTime(comment.createdAt)}
              </time>
              <Button variant="accentOutline" size="micro" onClick={onSubmit}>
                Send this
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }
  return (
    <Card
      className="review-staged-card w-full max-w-[17rem] border border-edge bg-comment-body! transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted"
      density="compact"
      elevation="floating"
      onPointerEnter={() => setAssociated(true)}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          setAssociated(false);
      }}
      onFocus={() => setAssociated(true)}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setAssociated(false);
      }}
      data-review-comment-ui=""
      data-review-associated={associated ? "true" : undefined}
      data-review-surface={surface}
    >
      <CommentCardHeader
        target={comment.target}
        surface={surface}
        metaClassName="review-staged-meta"
        targetClassName="review-staged-target"
        actionsClassName="review-staged-actions"
        onJump={onJump}
        onHeaderClick={onCollapse}
      >
        <ThreadIconButton
          label="Minimize staged comment"
          icon={MINIMIZE_2_ICON}
          onClick={onCollapse}
        />
        <ThreadIconButton
          label="Edit staged comment"
          icon={PENCIL_ICON}
          onClick={() => {
            setEditBody(comment.body);
            setIsEditing(true);
          }}
        />
        <ThreadIconButton
          label="Delete staged comment"
          icon={TRASH_2_ICON}
          onClick={onDelete}
          tone="danger"
        />
      </CommentCardHeader>
      {isEditing ? (
        <>
          <Textarea
            ref={editRef}
            className="mt-2 bg-input!"
            aria-label="Edit comment"
            value={editBody}
            maxLength={BODY_LIMIT}
            onChange={(event) => setEditBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditBody(comment.body);
                setIsEditing(false);
              } else if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                saveEdit();
              }
            }}
          />
          <p className="mt-1 text-2xs text-muted">
            Escape cancels · {MODIFIER_SHORTCUT} saves
          </p>
          <div className="mt-2 flex justify-end gap-1">
            <Button
              variant="outline"
              size="compact"
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </Button>
            <span className="group relative inline-flex">
              <Button
                size="micro"
                disabled={editBody.trim() === ""}
                onClick={saveEdit}
              >
                Save
              </Button>
              <span
                role="tooltip"
                className="invisible pointer-events-none absolute top-[calc(100%+0.35rem)] right-0 z-50 w-max rounded-sm bg-[var(--ink-c)] px-2 py-1 text-2xs font-medium text-[var(--bg)] opacity-0 transition-[opacity,visibility] duration-0 group-hover:visible group-hover:opacity-100 group-hover:delay-1000 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:delay-1000"
              >
                {MODIFIER_SHORTCUT}
              </span>
            </span>
          </div>
        </>
      ) : (
        <>
          <MarkdownBody
            body={visibleBody}
            className="review-staged-body mt-2 [overflow-wrap:anywhere] text-xs text-ink [&_p]:m-0 [&_p+p]:mt-2"
          />
          <p className="mt-2 mb-0 text-xs text-muted">
            <time dateTime={comment.createdAt}>
              {threadTime(comment.createdAt)}
            </time>
          </p>
        </>
      )}
      {!isEditing && long && !expanded ? (
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent px-0 py-1 text-xs font-semibold text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onExpandBody}
        >
          … more
        </button>
      ) : null}
      {isEditing ? null : (
        <div className="mt-2 flex items-center justify-end">
          <Button variant="accentOutline" size="micro" onClick={onSubmit}>
            Submit Now
          </Button>
        </div>
      )}
    </Card>
  );
};

const SentThread = ({
  comment,
  surface,
  associated,
  selected,
  identity,
  thread,
  expanded,
  resolved,
  onToggle,
  onResolve,
  onJump,
  onAssociate,
  onReplySent,
  onShowAgent,
  onCancelRequest,
  onDeleteQueued,
}: {
  readonly comment: ReviewComment;
  readonly surface: StagedCardSurface;
  readonly associated: boolean;
  readonly selected: boolean;
  readonly identity: RuntimeIdentity | null;
  readonly thread: CommentThreadProjection<AgentRequest, AgentResponse>;
  readonly expanded: boolean;
  readonly resolved: boolean;
  readonly onToggle: () => void;
  readonly onResolve: () => void;
  readonly onJump: () => void;
  readonly onAssociate: (target: CommentTarget | null) => void;
  readonly onReplySent: (message: string) => void;
  readonly onShowAgent: () => void;
  readonly onCancelRequest: (requestId: string) => void;
  readonly onDeleteQueued: () => void;
}) => {
  const [locations, setLocations] =
    useState<ReadonlyArray<DiffLocation> | null>(null);
  const [diffError, setDiffError] = useState("");
  const [reply, setReply] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const {
    exchanges,
    latestExchange,
    latestChanged,
    latestStatus,
    latestPending,
    latestCanceled,
    canDeleteQueued,
    group,
  } = thread;
  const outcome = latestExchange?.outcome;
  const targetPresent = targetElement(comment.target) !== null;
  const outcomeLabel = latestCanceled
    ? "Canceled"
    : outcome?.state === "changed"
      ? "Changed"
      : outcome?.state === "question"
        ? "Respond"
        : outcome?.state === "outside"
          ? "Outside this plan"
          : "Waiting for agent";
  const cardClass = `mt-2 w-full overflow-hidden border border-edge transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted data-[review-selected=true]:outline-3 data-[review-selected=true]:outline-offset-1 data-[review-selected=true]:outline-[color-mix(in_srgb,var(--annotation-c)_45%,var(--bg))] ${group === "working" ? "border-[var(--callout-note-c)]!" : ""} ${surface === "rail" ? "max-w-none bg-comment-body! p-0! shadow-raised" : "max-w-[17rem] bg-comment-body!"}`;
  const associate = () => onAssociate(comment.target);
  const railFreshness = threadTime(
    latestExchange?.response?.createdAt ??
      latestExchange?.request.createdAt ??
      comment.createdAt,
  );
  const railState = resolved
    ? "Resolved"
    : group === "needs-input"
      ? "Respond"
      : latestCanceled
        ? "Canceled"
        : group === "ready"
          ? outcome?.state === "changed"
            ? "Changed"
            : outcome?.state === "outside"
              ? "Outside plan"
              : "Ready"
          : group === "working"
            ? "Working"
            : "Queued";
  const railMetadata = `${railState} ${railFreshness === "Just now" ? "just now" : railFreshness}`;

  const loadDiff = async () => {
    if (
      identity === null ||
      latestChanged?.request === undefined ||
      latestChanged.response === undefined
    )
      return;
    try {
      const value = await requestJson({
        path: `/api/revision-diff?from=${encodeURIComponent(latestChanged.baselineRevision)}&to=${encodeURIComponent(latestChanged.response.sourceRevision)}`,
        identity,
      });
      setLocations(parseDiffLocations(value));
      setDiffError("");
    } catch (error) {
      setDiffError(errorMessage(error));
    }
  };

  const sendReply = async () => {
    const body = reply.trim();
    if (identity === null || body === "") return;
    setIsReplying(true);
    try {
      await requestJson({
        path: "/api/agent-requests",
        identity,
        method: "POST",
        body: { kind: "reply", commentId: comment.id, body },
      });
      setReply("");
      onReplySent("Reply sent to the coding agent.");
    } catch (error) {
      onReplySent(errorMessage(error));
    } finally {
      setIsReplying(false);
    }
  };

  if (!expanded) {
    if (surface === "thread") {
      return (
        <ContextualCommentSummary
          status={
            group === "working"
              ? "Working"
              : (latestStatus?.headline ?? outcomeLabel)
          }
          statusSpinner={group === "working"}
          statusIcon={
            latestStatus?.stage === "blocked" ? TRIANGLE_ALERT_ICON : undefined
          }
          statusClassName={
            latestCanceled
              ? ""
              : group === "ready"
                ? "bg-accent-soft text-accent"
                : group === "needs-input"
                  ? "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]"
                  : group === "working"
                    ? "bg-[var(--callout-note-bg)] text-[var(--callout-note-c)]"
                    : ""
          }
          body={comment.body}
          associated={associated}
          threadGroup={group}
          commentId={comment.id}
          onExpand={() => {
            onJump();
            onToggle();
          }}
          onAssociate={(active) => onAssociate(active ? comment.target : null)}
        >
          {canDeleteQueued ? (
            <ThreadIconButton
              label="Delete queued comment"
              icon={TRASH_2_ICON}
              onClick={onDeleteQueued}
              tone="danger"
            />
          ) : null}
          {!latestPending ? (
            <ThreadIconButton
              label={resolved ? "Unresolve comment" : "Resolve comment"}
              icon={CHECK_ICON}
              onClick={onResolve}
            />
          ) : null}
          {latestChanged === undefined ? null : (
            <ThreadIconButton
              label="Revert agent changes"
              icon={ROTATE_CCW_ICON}
              disabled
            />
          )}
        </ContextualCommentSummary>
      );
    }
    return (
      <Card
        className={cardClass}
        density="dense"
        elevation="none"
        onPointerEnter={associate}
        onPointerLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement))
            onAssociate(null);
        }}
        onFocus={associate}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            onAssociate(null);
        }}
        data-review-sent-thread={group}
        data-review-comment-id={comment.id}
        data-review-comment-ui=""
        data-review-associated={associated ? "true" : undefined}
        data-review-selected={selected ? "true" : undefined}
      >
        <CommentCardHeader
          target={comment.target}
          surface={surface}
          metaClassName="review-thread-meta"
          targetClassName="review-sent-target"
          actionsClassName="review-thread-actions"
          onJump={onJump}
          onHeaderClick={onToggle}
          onTargetClick={onJump}
        >
          <ThreadIconButton
            label="Expand thread"
            icon={MAXIMIZE_2_ICON}
            onClick={onToggle}
          />
          {canDeleteQueued ? (
            <ThreadIconButton
              label="Delete queued comment"
              icon={TRASH_2_ICON}
              onClick={onDeleteQueued}
              tone="danger"
            />
          ) : null}
          {latestChanged === undefined ? null : (
            <ThreadIconButton
              label="Revert agent changes"
              icon={ROTATE_CCW_ICON}
              disabled
              tone="danger"
            />
          )}
          <ThreadIconButton
            label={resolved ? "Unresolve comment" : "Resolve comment"}
            icon={CHECK_ICON}
            onClick={onResolve}
            tone="positive"
          />
        </CommentCardHeader>
        <div className="p-3">
          <button
            type="button"
            className="review-sent-summary line-clamp-3 min-w-0 w-full cursor-pointer [overflow-wrap:anywhere] border-0 bg-transparent p-0 text-left text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label={`Expand thread: ${comment.body}`}
            aria-expanded="false"
            onClick={onToggle}
          >
            {comment.body}
          </button>
          <div className="mt-3 flex min-w-0 items-center justify-between gap-2 text-xs text-muted">
            <span className="min-w-0 truncate font-medium">{railMetadata}</span>
            {resolved ? (
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={onResolve}
              >
                Unresolve
              </button>
            ) : !latestPending ? (
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={() => {
                  onJump();
                  onToggle();
                }}
              >
                {group === "needs-input" ? "Reply" : "Review"}
              </button>
            ) : (
              <button
                type="button"
                className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-muted hover:text-danger hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                onClick={() =>
                  onCancelRequest(latestExchange?.request.requestId ?? "")
                }
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cardClass}
      density={surface === "rail" ? "dense" : "compact"}
      elevation={surface === "rail" ? "none" : "floating"}
      onPointerEnter={associate}
      onPointerLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement))
          onAssociate(null);
      }}
      onFocus={() => onAssociate(comment.target)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onAssociate(null);
      }}
      data-review-sent-thread={group}
      data-review-comment-id={comment.id}
      data-review-comment-ui=""
      data-review-associated={associated ? "true" : undefined}
      data-review-selected={selected ? "true" : undefined}
    >
      <CommentCardHeader
        target={comment.target}
        surface={surface}
        metaClassName="review-thread-meta"
        targetClassName="review-sent-target"
        actionsClassName="review-thread-actions"
        onJump={onJump}
        onHeaderClick={onToggle}
        onTargetClick={onJump}
      >
        <ThreadIconButton
          label="Minimize thread"
          icon={MINIMIZE_2_ICON}
          onClick={onToggle}
        />
        {canDeleteQueued ? (
          <ThreadIconButton
            label="Delete queued comment"
            icon={TRASH_2_ICON}
            onClick={onDeleteQueued}
            tone="danger"
          />
        ) : null}
        {latestChanged === undefined ? null : (
          <ThreadIconButton
            label="Revert agent changes"
            icon={ROTATE_CCW_ICON}
            disabled
            tone="danger"
          />
        )}
        <ThreadIconButton
          label={resolved ? "Unresolve comment" : "Resolve comment"}
          icon={CHECK_ICON}
          onClick={onResolve}
          tone="positive"
        />
      </CommentCardHeader>
      <div className={surface === "rail" ? "p-3" : ""}>
        {!targetPresent ? (
          <p className="mt-3 mb-0 rounded-md bg-[var(--callout-warning-bg)] p-2 text-xs text-[var(--callout-warning-ink)]">
            Original target unavailable in this revision. This thread keeps its
            recorded address; Big Plan did not guess a replacement.
          </p>
        ) : null}
        <div className="mt-2 min-w-0">
          {exchanges.length === 0 ? (
            <MessageTurn
              role="user"
              surface="thread"
              body={comment.body}
              createdAt={comment.createdAt}
              delivery="Saved"
            />
          ) : (
            exchanges.map(
              ({
                request,
                response,
                outcome: requestOutcome,
                status: requestStatus,
                activity,
              }) => {
                const sharedConnectionState =
                  surface === "rail" &&
                  (requestStatus.stage === "blocked" ||
                    requestStatus.stage === "offline");
                return (
                  <div key={request.requestId}>
                    <MessageTurn
                      role="user"
                      surface="thread"
                      body={
                        request.kind === "feedback"
                          ? comment.body
                          : (request.body ?? "")
                      }
                      createdAt={request.createdAt}
                      delivery={
                        response !== undefined ||
                        request.claimedAt !== undefined
                          ? "Sent"
                          : "Queued"
                      }
                    >
                      {request.kind === "feedback" &&
                      comment.target.type === "selection" &&
                      response !== undefined &&
                      response.sourceRevision !== request.sourceRevision ? (
                        <blockquote className="mt-2 mb-0 border-l-2 border-[var(--annotation-c)] pl-2 text-xs text-muted">
                          You commented on: “{comment.target.quote}” — this text
                          was revised
                        </blockquote>
                      ) : null}
                    </MessageTurn>
                    {requestOutcome === undefined || response === undefined ? (
                      sharedConnectionState ? (
                        <button
                          type="button"
                          className="mt-2 ml-auto block cursor-pointer border-0 bg-transparent p-0 text-2xs text-muted underline underline-offset-[0.16em] hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                          onClick={() => onCancelRequest(request.requestId)}
                        >
                          Cancel request
                        </button>
                      ) : (
                        <RequestStatusStrip
                          status={requestStatus}
                          activity={activity}
                          surface="thread"
                          commentCount={
                            request.kind === "feedback"
                              ? Math.max(1, requestCommentIds(request).length)
                              : 1
                          }
                          onShowAgent={onShowAgent}
                          onCancelRequest={() =>
                            onCancelRequest(request.requestId)
                          }
                        />
                      )
                    ) : (
                      <MessageTurn
                        role="agent"
                        surface="thread"
                        body={requestOutcome.message}
                        createdAt={response.createdAt}
                      >
                        {requestOutcome.state === "changed" &&
                        response.requestId ===
                          latestChanged?.response?.requestId ? (
                          <AgentChangeDigest
                            changes={locations}
                            isLoading={false}
                            onLoad={() => void loadDiff()}
                          />
                        ) : null}
                      </MessageTurn>
                    )}
                  </div>
                );
              },
            )
          )}
        </div>
        {diffError === "" ? null : (
          <p className="mt-2 mb-0 text-xs text-danger">{diffError}</p>
        )}
        {identity === null ? null : (
          <div className="mt-3 border-t border-edge pt-3">
            {latestExchange?.response === undefined ? null : (
              <section
                className="mb-3 grid gap-2"
                data-review-thread-next-steps
              >
                <strong className="text-2xs font-bold uppercase tracking-caps text-subtle">
                  Next steps
                </strong>
                <div className="flex items-center gap-1">
                  <ThreadIconButton
                    label="Minimize thread"
                    icon={MINIMIZE_2_ICON}
                    onClick={onToggle}
                  />
                  <ThreadIconButton
                    label={resolved ? "Unresolve comment" : "Resolve comment"}
                    icon={CHECK_ICON}
                    onClick={onResolve}
                  />
                  {latestChanged === undefined ? null : (
                    <ThreadIconButton
                      label="Revert agent changes"
                      icon={ROTATE_CCW_ICON}
                      disabled
                    />
                  )}
                </div>
              </section>
            )}
            <Textarea
              id={`reply-${comment.id}`}
              className="mt-1 min-h-20"
              value={reply}
              maxLength={BODY_LIMIT}
              placeholder="Reply to the agent…"
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendReply();
                }
              }}
            />
            <div className="mt-2 flex justify-end">
              <DelayedTooltip label={`Reply · ${MODIFIER_SHORTCUT}`}>
                <Button
                  size="compact"
                  disabled={reply.trim() === "" || isReplying}
                  onClick={() => void sendReply()}
                >
                  {isReplying ? "Sending…" : "Reply"}
                </Button>
              </DelayedTooltip>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

const ChatExchange = ({
  request,
  response,
  identity,
  status,
  activity,
  onStatus,
  onShowAgent,
  onCancelRequest,
}: {
  readonly request: AgentRequest;
  readonly response: AgentResponse | undefined;
  readonly identity: RuntimeIdentity;
  readonly status: AgentStatus;
  readonly activity: ReadonlyArray<MessageActivity>;
  readonly onStatus: (message: string) => void;
  readonly onShowAgent: () => void;
  readonly onCancelRequest: (requestId: string) => void;
}) => {
  const [locations, setLocations] =
    useState<ReadonlyArray<DiffLocation> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const hasChanges =
    response !== undefined &&
    (request.claimedFromRevision ?? request.sourceRevision) !==
      response.sourceRevision;
  const loadDiff = async () => {
    if (response === undefined) return;
    setIsLoading(true);
    try {
      const value = await requestJson({
        path: `/api/revision-diff?from=${encodeURIComponent(request.claimedFromRevision ?? request.sourceRevision)}&to=${encodeURIComponent(response.sourceRevision)}`,
        identity,
      });
      setLocations(parseDiffLocations(value));
    } catch (error) {
      onStatus(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <li className="grid min-w-0 gap-2">
      <MessageTurn
        role="user"
        surface="chat"
        body={request.body ?? ""}
        createdAt={request.createdAt}
        delivery={
          response !== undefined || request.claimedAt !== undefined
            ? "Sent"
            : "Queued"
        }
      />
      {response === undefined ? (
        <div className="min-w-0 w-[calc(100%_-_1.5rem)] rounded-lg border border-dashed border-edge bg-paper px-2 py-2 text-muted">
          <RequestStatusStrip
            status={status}
            activity={activity}
            surface="chat"
            onShowAgent={onShowAgent}
            onCancelRequest={() => onCancelRequest(request.requestId)}
          />
        </div>
      ) : (
        <MessageTurn
          role="agent"
          surface="chat"
          body={response.message ?? ""}
          createdAt={response.createdAt}
        >
          {hasChanges ? (
            <AgentChangeDigest
              changes={locations}
              isLoading={isLoading}
              onLoad={() => void loadDiff()}
            />
          ) : null}
        </MessageTurn>
      )}
    </li>
  );
};

const ReviewKernel = () => {
  const identity = useMemo(runtimeIdentity, []);
  const initialSourceRevision = useMemo(bootstrapSourceRevision, []);
  const planId =
    identity?.planId ?? rootElement.getAttribute("data-plan-id") ?? "";
  const blockHosts = useBlockHosts();
  const reviewContainerHosts = useReviewContainerHosts();
  const feedbackHost = useFeedbackHost();
  const [drafts, setDrafts] = useState<ReadonlyArray<ReviewComment>>([]);
  const [sent, setSent] = useState<ReadonlyArray<ReviewComment>>([]);
  const [resolvedCommentIds, setResolvedCommentIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [pendingCompose, setPendingCompose] = useState<ComposeState | null>(
    null,
  );
  const [selectionControl, setSelectionControl] =
    useState<SelectionControlState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<FeedbackTab>("comments");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatBody, setChatBody] = useState("");
  const [agent, setAgent] = useState<AgentSnapshot>(emptyAgentSnapshot);
  const [cancelPendingRequestIds, setCancelPendingRequestIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [progress, setProgress] = useState<ReadonlyArray<ProgressEvent>>([]);
  const [runtimeSession, setRuntimeSession] = useState<RuntimeSession | null>(
    null,
  );
  const [pollFailures, setPollFailures] = useState(0);
  const [statusNowMs, setStatusNowMs] = useState(Date.now());
  const [threadOpenState, setThreadOpenState] = useState<ThreadOpenState>(
    new Map(),
  );
  const [expandedBodies, setExpandedBodies] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [submitRightAway, setSubmitRightAway] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [associatedTarget, setAssociatedTarget] =
    useState<CommentTarget | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null,
  );
  const [associationActive, setAssociationActive] = useState(false);
  const [status, setStatus] = useState(
    identity === null
      ? "Reading offline: drafts stay in this browser."
      : "Loading review…",
  );
  const reviewComments = useMemo(
    () => [
      ...drafts,
      ...sent.filter((comment) => !resolvedCommentIds.has(comment.id)),
    ],
    [drafts, resolvedCommentIds, sent],
  );
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
  const acceptAgentSnapshot = useCallback((snapshot: AgentSnapshot) => {
    setAgent(snapshot);
    setCancelPendingRequestIds((current) =>
      reconcilePendingCancellations({
        pendingRequestIds: current,
        requests: snapshot.requests,
      }),
    );
  }, []);
  const serializeRuntimeWrite = useCallback(
    <Value,>(write: () => Promise<Value>): Promise<Value> => {
      const result = persistenceQueue.current.then(write, write);
      persistenceQueue.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [],
  );
  const inlineComposeHost = useInlineComposeHost(compose, isOpen);
  const threadHosts = useThreadHosts(reviewComments, isOpen);
  const feedbackTabs =
    identity === null ? STATIC_FEEDBACK_TABS : LIVE_FEEDBACK_TABS;
  const selectFeedbackTab = (next: FeedbackTab) => {
    setTab(next);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#review-tab-${next}`)?.focus(),
    );
  };
  const showAgentSetup = () => {
    setIsOpen(true);
    selectFeedbackTab("agent");
  };
  const handleFeedbackTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let index = feedbackTabs.indexOf(tab);
    if (event.key === "ArrowRight") index = (index + 1) % feedbackTabs.length;
    else if (event.key === "ArrowLeft")
      index = (index - 1 + feedbackTabs.length) % feedbackTabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = feedbackTabs.length - 1;
    else return;
    event.preventDefault();
    const next = feedbackTabs[index];
    if (next !== undefined) selectFeedbackTab(next);
  };

  useEffect(() => {
    rootElement.toggleAttribute("data-review-kernel-open", isOpen);
    return () => rootElement.removeAttribute("data-review-kernel-open");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setThreadOpenState(clearThreadOpenOverlay);
  }, [isOpen]);

  useEffect(() => {
    if (compose === null) return;
    const closeComposer = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setCompose(null);
    };
    document.addEventListener("keydown", closeComposer);
    return () => document.removeEventListener("keydown", closeComposer);
  }, [compose]);

  useEffect(() => {
    const composeSelection =
      compose?.target.type === "selection" ? compose.target : null;
    const persistentSelections = reviewComments
      .map((comment) => comment.target)
      .filter(
        (target): target is SelectionTarget => target.type === "selection",
      );
    if (composeSelection !== null) persistentSelections.push(composeSelection);
    const associatedSelection =
      associatedTarget?.type === "selection" ? associatedTarget : null;
    const activeSelection =
      associatedSelection ?? (associationActive ? composeSelection : null);
    setSelectionHighlights(persistentSelections, activeSelection);
    rootElement.toggleAttribute(
      "data-review-selection-active",
      activeSelection !== null,
    );
    return () => {
      setSelectionHighlights([], null);
      rootElement.removeAttribute("data-review-selection-active");
    };
  }, [associatedTarget, associationActive, compose, reviewComments]);

  useEffect(() => {
    if (associatedTarget === null) return undefined;
    const associatedElements = targetAssociationElements(associatedTarget);
    for (const element of associatedElements) {
      element.dataset.reviewCommentAssociated = "";
    }
    return () => {
      for (const element of associatedElements) {
        delete element.dataset.reviewCommentAssociated;
      }
    };
  }, [associatedTarget]);

  useEffect(() => {
    if (selectedCommentId === null) return undefined;
    const comment = reviewComments.find(
      (candidate) => candidate.id === selectedCommentId,
    );
    if (comment === undefined) return undefined;
    const selectedElements = targetAssociationElements(comment.target);
    for (const element of selectedElements) {
      element.dataset.reviewCommentSelected = "";
    }
    return () => {
      for (const element of selectedElements) {
        delete element.dataset.reviewCommentSelected;
      }
    };
  }, [reviewComments, selectedCommentId]);

  useEffect(() => {
    const marked = new Set<HTMLElement>();
    const entries = reviewComments.flatMap((comment) => {
      const element = targetElement(comment.target);
      if (element === null) return [];
      for (const associatedElement of targetAssociationElements(
        comment.target,
      )) {
        associatedElement.dataset.reviewHasComment = "";
        marked.add(associatedElement);
      }
      return [
        {
          target: comment.target,
          element,
          selectionRects: [] as ReadonlyArray<DOMRect>,
          area: 0,
        },
      ];
    });
    const refreshGeometry = () => {
      for (const entry of entries) {
        if (entry.target.type === "selection") {
          const range = selectionRange(entry.target);
          entry.selectionRects =
            range === null ? [] : Array.from(range.getClientRects());
        } else {
          const rect = entry.element.getBoundingClientRect();
          entry.area = rect.width * rect.height;
        }
      }
    };
    refreshGeometry();
    let frame = 0;
    let pending:
      | {
          readonly x: number;
          readonly y: number;
          readonly target: EventTarget | null;
        }
      | undefined;
    const inspect = () => {
      frame = 0;
      const current = pending;
      pending = undefined;
      if (current === undefined) return;
      const eventTarget = current.target;
      const eventElement =
        eventTarget instanceof Element
          ? eventTarget
          : eventTarget instanceof Node
            ? eventTarget.parentElement
            : null;
      const focusedComment =
        document.activeElement instanceof Element
          ? document.activeElement.closest(
              "[data-review-comment-ui], [data-review-comment-id]",
            )
          : null;
      if (
        focusedComment !== null ||
        (eventTarget instanceof Node &&
          document
            .querySelector("#big-plan-review-root")
            ?.contains(eventTarget)) ||
        Boolean(eventElement?.closest("[data-review-comment-ui]"))
      ) {
        return;
      }
      const selected = entries.find(({ target, selectionRects }) => {
        if (target.type !== "selection") return false;
        return selectionRects.some(
          (rect) =>
            current.x >= rect.left &&
            current.x <= rect.right &&
            current.y >= rect.top &&
            current.y <= rect.bottom,
        );
      });
      if (selected !== undefined) {
        setAssociatedTarget(selected.target);
        return;
      }
      const containing = entries
        .filter(
          ({ target, element }) =>
            target.type !== "selection" &&
            eventTarget instanceof Node &&
            element.contains(eventTarget),
        )
        .sort((left, right) => left.area - right.area)[0];
      setAssociatedTarget(containing?.target ?? null);
    };
    const move = (event: PointerEvent) => {
      pending = { x: event.clientX, y: event.clientY, target: event.target };
      if (frame === 0) frame = requestAnimationFrame(inspect);
    };
    const refresh = () => refreshGeometry();
    document.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
      for (const element of marked) delete element.dataset.reviewHasComment;
    };
  }, [reviewComments]);

  useEffect(() => {
    const selection =
      compose?.target.type === "selection" ? compose.target : null;
    const block = selection === null ? null : targetElement(selection);
    if (block !== null) {
      block.dataset.reviewSelectionAssociated = "";
      const enter = () => setAssociationActive(true);
      const leave = () => setAssociationActive(false);
      block.addEventListener("pointerenter", enter);
      block.addEventListener("pointerleave", leave);
      return () => {
        block.removeEventListener("pointerenter", enter);
        block.removeEventListener("pointerleave", leave);
        delete block.dataset.reviewSelectionAssociated;
      };
    }
    return undefined;
  }, [compose]);

  useEffect(() => {
    for (const { container } of reviewContainerHosts) {
      const selected =
        compose?.target.type === "block" &&
        targetElement(compose.target) === container;
      container.toggleAttribute("data-review-slide-selected", selected);
    }
  }, [compose, reviewContainerHosts]);

  useEffect(() => {
    for (const { block } of blockHosts) {
      const selected =
        compose?.target.type === "block" &&
        targetElement(compose.target) === block;
      block.toggleAttribute("data-review-block-selected", selected);
    }
  }, [blockHosts, compose]);

  useEffect(() => {
    let current = true;
    void (async () => {
      if (identity === null) {
        setDrafts(planId === "" ? [] : readLocalDrafts(planId));
        setIsHydrated(true);
        return;
      }
      try {
        const session = parseRuntimeSession({
          value: await requestJson({ path: "/api/session", identity }),
          sessionId: identity.sessionId,
        });
        if (session === null) {
          throw new Error("This page is not connected to its review runtime.");
        }
        setRuntimeSession(session);
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        if (current) {
          setDrafts(snapshot.drafts);
          setSent(snapshot.sent);
          setResolvedCommentIds(new Set(snapshot.resolvedCommentIds));
          setStatus("Connected to the local review runtime.");
          setIsHydrated(true);
        }
      } catch (error) {
        if (current) {
          setStatus(errorMessage(error));
          setIsHydrated(true);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [identity, planId]);

  useEffect(() => {
    if (!isHydrated) return;
    if (identity === null) {
      if (planId !== "") writeLocalDrafts(planId, drafts);
      return;
    }
    void serializeRuntimeWrite(() =>
      requestJson({
        path: "/api/drafts",
        identity,
        method: "PUT",
        body: {
          drafts,
          activeDraft: "",
          resolvedCommentIds: Array.from(resolvedCommentIds),
        },
      }),
    ).catch((error: unknown) => setStatus(errorMessage(error)));
  }, [
    drafts,
    identity,
    isHydrated,
    planId,
    resolvedCommentIds,
    serializeRuntimeWrite,
  ]);

  useEffect(() => {
    if (identity === null) return;
    let current = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [sessionValue, agentValue, progressValue] = await Promise.all([
          requestJson({ path: "/api/session", identity }),
          requestJson({ path: "/api/agent", identity }),
          requestJson({ path: "/api/progress", identity }),
        ]);
        if (current) {
          const session = parseRuntimeSession({
            value: sessionValue,
            sessionId: identity.sessionId,
          });
          if (session === null) {
            throw new Error(
              "This page is not connected to its review runtime.",
            );
          }
          setRuntimeSession(session);
          acceptAgentSnapshot(parseAgentSnapshot(agentValue));
          setProgress(parseProgress(progressValue));
          setPollFailures(0);
          setStatusNowMs(Date.now());
        }
      } catch {
        if (current) {
          setPollFailures((failures) => Math.min(2, failures + 1));
          setStatusNowMs(Date.now());
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [acceptAgentSnapshot, identity]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setSelectionControl(selectionControlState()),
      );
    };
    const clear = () => setSelectionControl(null);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", clear, { passive: true });
    window.addEventListener("resize", clear, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", clear);
      window.removeEventListener("resize", clear);
    };
  }, []);

  const beginTarget = useCallback(
    (target: CommentTarget, rect: Pick<DOMRect, "top">) => {
      if (runtimeSession?.authoritative === false) {
        setIsOpen(true);
        setTab("agent");
        return;
      }
      if (
        compose !== null &&
        targetAddress(compose.target) === targetAddress(target)
      ) {
        return;
      }
      const targetRect = targetElement(target)?.getBoundingClientRect();
      const composerWidth = 17 * 16;
      const edge = 24;
      const overlap = 12;
      const viewportWidth = document.documentElement.clientWidth;
      const next = {
        target,
        top:
          window.scrollY +
          Math.max(56, Math.min(rect.top, window.innerHeight - 360)),
        left: Math.max(
          edge + window.scrollX,
          Math.min(
            (targetRect?.right ?? viewportWidth) + window.scrollX - overlap,
            window.scrollX + viewportWidth - composerWidth - edge,
          ),
        ),
      };
      if (compose === null || composeBody.trim() === "") {
        setComposeBody("");
        setCompose(next);
        return;
      }
      setPendingCompose(next);
    },
    [compose, composeBody, runtimeSession?.authoritative],
  );

  const sendComments = async (comments: ReadonlyArray<ReviewComment>) => {
    if (identity === null) {
      setStatus(
        "Start `big-plan review` to submit comments. Your drafts are saved.",
      );
      return;
    }
    setIsSending(true);
    try {
      const result = parseSnapshot(
        await serializeRuntimeWrite(() =>
          requestJson({
            path: "/api/feedback",
            identity,
            method: "POST",
            body: { comments },
          }),
        ),
      );
      const ids = new Set(comments.map((comment) => comment.id));
      setDrafts((current) => current.filter((comment) => !ids.has(comment.id)));
      setSent((current) =>
        result.sent.length > 0 ? result.sent : [...current, ...comments],
      );
      setStatus(
        `${comments.length} comment${comments.length === 1 ? "" : "s"} submitted.`,
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  const saveComment = (body: string, submitRightAway: boolean) => {
    if (compose === null) return;
    const comment: ReviewComment = {
      id: randomId(),
      body,
      createdAt: new Date().toISOString(),
      target: compose.target,
    };
    setDrafts((current) => [...current, comment]);
    setCompose(null);
    setComposeBody("");
    setTab("comments");
    setStatus("Comment staged locally.");
    if (submitRightAway) void sendComments([comment]);
  };

  const deleteDraft = (id: string) => {
    setDrafts((current) => current.filter((comment) => comment.id !== id));
    setPendingDelete(null);
    setStatus("Staged comment deleted.");
  };
  const deleteAllDrafts = () => {
    setDrafts([]);
    setPendingDelete(null);
    setStatus("All staged comments deleted.");
  };
  const deleteQueuedComment = async (commentId: string) => {
    if (identity === null) return;
    try {
      await serializeRuntimeWrite(() =>
        requestJson({
          path: "/api/comments-delete",
          identity,
          method: "POST",
          body: { commentId },
        }),
      );
      const [snapshotValue, agentValue] = await Promise.all([
        requestJson({ path: "/api/drafts", identity }),
        requestJson({ path: "/api/agent", identity }),
      ]);
      const snapshot = parseSnapshot(snapshotValue);
      setSent(snapshot.sent);
      setResolvedCommentIds(new Set(snapshot.resolvedCommentIds));
      acceptAgentSnapshot(parseAgentSnapshot(agentValue));
      setThreadOpenState((current) =>
        setThreadOpen({
          state: current,
          commentId,
          kind: "sent",
          surface: "rail",
          isRailOpen: isOpen,
          open: false,
        }),
      );
      if (selectedCommentId === commentId) setSelectedCommentId(null);
      setPendingDelete(null);
      setStatus("Queued comment deleted.");
    } catch (error) {
      setPendingDelete(null);
      setStatus(errorMessage(error));
    }
  };
  const jumpTo = (comment: ReviewComment) => {
    setAssociatedTarget(comment.target);
    targetElement(comment.target)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  const updateDraft = (id: string, body: string) => {
    setDrafts((current) =>
      current.map((comment) =>
        comment.id === id ? { ...comment, body } : comment,
      ),
    );
    setStatus("Comment updated locally.");
  };

  const sendChat = async () => {
    const body = chatBody.trim();
    if (identity === null) {
      setStatus("Start `big-plan review` to ask the coding agent.");
      return;
    }
    if (body === "") return;
    setIsSendingChat(true);
    try {
      await requestJson({
        path: "/api/agent-requests",
        identity,
        method: "POST",
        body: { kind: "chat", body },
      });
      setChatBody("");
      acceptAgentSnapshot(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
      setStatus("Plan question sent to the coding agent.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsSendingChat(false);
    }
  };

  const cancelRequest = async (requestId: string) => {
    if (identity === null) return;
    setCancelPendingRequestIds((current) => new Set([...current, requestId]));
    try {
      await requestJson({
        path: "/api/agent-cancel",
        identity,
        method: "POST",
        body: { requestId },
      });
      acceptAgentSnapshot(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
      setStatus("Agent request canceled.");
    } catch (error) {
      setCancelPendingRequestIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
      try {
        acceptAgentSnapshot(
          parseAgentSnapshot(
            await requestJson({ path: "/api/agent", identity }),
          ),
        );
      } catch {
        // Preserve the original cancel failure. The poll loop will recover the
        // snapshot when the runtime becomes reachable again.
      }
      setStatus(errorMessage(error));
    }
  };

  const threadRuntime: ThreadRuntime =
    identity === null ? "static" : pollFailures >= 2 ? "offline" : "online";
  const threadProjections = projectCommentThreads({
    comments: sent,
    requests: agent.requests,
    responses: agent.responses,
    progressEvents: progress,
    presence: agent.presence,
    runtime: threadRuntime,
    nowMs: statusNowMs,
    cancelPendingRequestIds,
  });
  const cancelRequestsForComment = (commentId: string) => {
    const thread = threadProjections.get(commentId);
    if (thread === undefined) return;
    for (const exchange of thread.exchanges) {
      if (exchange.response === undefined && !exchange.canceled) {
        void cancelRequest(exchange.request.requestId);
      }
    }
  };

  const latestRequest = agent.requests.at(-1);
  const latestResponse = agent.responses.find(
    (response) => response.requestId === latestRequest?.requestId,
  );
  const requestProgress =
    latestRequest === undefined
      ? []
      : progress.filter((event) => event.requestId === latestRequest.requestId);
  const failure = [...requestProgress]
    .reverse()
    .find((event) => event.state === "failed")?.detail;
  const lastAgentSignalAtMs = Math.max(
    0,
    ...requestProgress.map((event) => event.atMs ?? 0),
    latestRequest?.claimedAt === undefined
      ? 0
      : Date.parse(latestRequest.claimedAt),
    agent.presence.requestId === latestRequest?.requestId
      ? (agent.presence.updatedAtMs ?? 0)
      : 0,
  );
  const agentStatus: AgentStatus = deriveAgentStatus({
    runtime: threadRuntime,
    request:
      latestRequest === undefined
        ? "none"
        : latestResponse === undefined &&
            !requestIsCanceled({
              request: latestRequest,
              pendingRequestIds: cancelPendingRequestIds,
            })
          ? "pending"
          : "answered",
    agentConnected: agent.presence.connected,
    pickedUp:
      latestRequest?.claimedAt !== undefined || requestProgress.length > 0,
    ...(lastAgentSignalAtMs > 0 ? { lastAgentSignalAtMs } : {}),
    ...(failure === undefined ? {} : { failure }),
    nowMs: statusNowMs,
  });
  const activityForRequest = (
    request: AgentRequest,
  ): ReadonlyArray<MessageActivity> =>
    projectRequestActivity({ request, progressEvents: progress });
  const statusForRequest = (
    request: AgentRequest,
    surface: MessageSurface,
  ): AgentStatus =>
    projectRequestStatus({
      request,
      response: agent.responses.find(
        (candidate) => candidate.requestId === request.requestId,
      ),
      progressEvents: progress,
      presence: agent.presence,
      runtime: threadRuntime,
      surface,
      nowMs: statusNowMs,
      cancelPendingRequestIds,
    });
  const currentAgentActivity = deriveCurrentAgentActivity({
    requests: agent.requests,
    responseRequestIds: new Set([
      ...agent.responses.map((response) => response.requestId),
      ...agent.requests.flatMap((request) =>
        requestIsCanceled({
          request,
          pendingRequestIds: cancelPendingRequestIds,
        })
          ? [request.requestId]
          : [],
      ),
    ]),
    progressEvents: progress,
    agentConnected: agent.presence.connected,
    runtimeOffline: pollFailures >= 2,
    now: statusNowMs,
    heartbeatAt: agent.presence.updatedAtMs ?? 0,
  });
  const chatRequests = agent.requests.filter(
    (request) => request.kind === "chat",
  );
  const unresolvedSent = sent.filter(
    (comment) => !resolvedCommentIds.has(comment.id),
  );
  const sentByGroup = new Map<ThreadGroup, ReadonlyArray<ReviewComment>>(
    (["needs-input", "ready", "working", "queued"] as const).map((group) => [
      group,
      unresolvedSent.filter(
        (comment) => threadProjections.get(comment.id)?.group === group,
      ),
    ]),
  );
  const resolvedSent = sent.filter((comment) =>
    resolvedCommentIds.has(comment.id),
  );
  const agentHealthLabel = deriveAgentHealthLabel({
    activity: currentAgentActivity,
    hasAgentRuntime: identity !== null,
    isReadOnly: runtimeSession?.authoritative === false,
  });
  const newerRevisionAvailable =
    initialSourceRevision !== "" &&
    agent.sourceRevision !== "" &&
    initialSourceRevision !== agent.sourceRevision;
  const threadIsOpen = ({
    commentId,
    kind,
    surface,
  }: {
    readonly commentId: string;
    readonly kind: ThreadKind;
    readonly surface: ThreadSurface;
  }): boolean =>
    isThreadOpen({
      state: threadOpenState,
      commentId,
      kind,
      surface,
      isRailOpen: isOpen,
    });
  const toggleCommentThread = ({
    commentId,
    kind,
    surface,
  }: {
    readonly commentId: string;
    readonly kind: ThreadKind;
    readonly surface: ThreadSurface;
  }) =>
    setThreadOpenState((current) =>
      toggleThreadOpen({
        state: current,
        commentId,
        kind,
        surface,
        isRailOpen: isOpen,
      }),
    );
  const toggleResolvedComment = (commentId: string) => {
    if (!resolvedCommentIds.has(commentId)) {
      cancelRequestsForComment(commentId);
      if (selectedCommentId === commentId) setSelectedCommentId(null);
      const comment = sent.find((candidate) => candidate.id === commentId);
      if (
        comment !== undefined &&
        associatedTarget !== null &&
        targetAddress(comment.target) === targetAddress(associatedTarget)
      ) {
        setAssociatedTarget(null);
      }
      setThreadOpenState((current) =>
        setThreadOpen({
          state: current,
          commentId,
          kind: "sent",
          surface: "rail",
          isRailOpen: isOpen,
          open: false,
        }),
      );
    }
    setResolvedCommentIds((current) => {
      const next = new Set(current);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };
  const viewAgentRequest = (requestId: string, kind: string) => {
    if (kind === "chat") {
      setTab("chat");
      return;
    }
    const request = agent.requests.find(
      (candidate) => candidate.requestId === requestId,
    );
    const commentId =
      request === undefined ? undefined : requestCommentIds(request)[0];
    if (commentId === undefined) return;
    const comment = sent.find((candidate) => candidate.id === commentId);
    if (comment === undefined) return;
    setSelectedCommentId(commentId);
    setAssociatedTarget(comment.target);
    setThreadOpenState((current) =>
      setThreadOpen({
        state: current,
        commentId,
        kind: "sent",
        surface: "rail",
        isRailOpen: isOpen,
        open: true,
      }),
    );
    setTab("comments");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-review-comment-id="${CSS.escape(commentId)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" });
        document
          .querySelector<HTMLTextAreaElement>(`#reply-${CSS.escape(commentId)}`)
          ?.focus({ preventScroll: true });
      });
    });
  };

  return (
    <>
      {reviewContainerHosts.map(({ container, host }) => {
        const target = targetForReviewContainer(container);
        if (target === null) return null;
        const pressed =
          compose?.target.type === "block" &&
          targetElement(compose.target) === container;
        const label = container.matches("[data-quick-summary]")
          ? "Comment on quick summary"
          : "Comment on slide";
        return createPortal(
          <button
            type="button"
            className="group relative inline-flex size-[1.4rem] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] p-0 text-subtle hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:bg-surface aria-pressed:text-ink [&>svg]:size-3.5"
            aria-label={label}
            aria-pressed={pressed}
            onClick={() =>
              beginTarget(target, container.getBoundingClientRect())
            }
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
            <span
              role="tooltip"
              className="invisible pointer-events-none absolute top-[calc(100%+0.5rem)] left-0 z-50 w-max max-w-48 rounded-md bg-[var(--ink-c)] px-2 py-1 text-2xs leading-normal text-[var(--bg)] opacity-0 shadow-raised delay-1000 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 max-sm:right-0 max-sm:left-auto"
            >
              {label}
            </span>
          </button>,
          host,
          target.blockId,
        );
      })}
      {blockHosts.map(({ block, host }) =>
        createPortal(
          block.dataset.blockKind === "data-table" ||
            block.dataset.blockKind === "table" ? (
            <button
              type="button"
              className="review-table-comment group relative inline-flex size-[1.4rem] cursor-pointer items-center justify-center rounded-sm border border-transparent bg-transparent p-0 text-muted hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:text-ink [&>svg]:size-3.5"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this table"}`}
              aria-pressed={
                compose?.target.type === "block" &&
                targetElement(compose.target) === block
              }
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
              <span
                role="tooltip"
                className="invisible pointer-events-none absolute top-[calc(100%+0.5rem)] right-0 z-50 w-max rounded-md bg-[var(--ink-c)] px-2 py-1 text-xs text-[var(--bg)] opacity-0 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
              >
                Comment on table
              </span>
            </button>
          ) : host.dataset.reviewToolbarHost !== undefined ? (
            <button
              type="button"
              className="review-toolbar-comment inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted hover:text-ink focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:text-ink [&>svg]:size-3.5"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this component"}`}
              aria-pressed={
                compose?.target.type === "block" &&
                targetElement(compose.target) === block
              }
              data-tooltip={`Comment on ${block.dataset.blockLabel ?? "component"}`}
              data-tooltip-delay="1s"
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="review-block-button"
              aria-label={`Comment on ${block.dataset.blockLabel ?? "this component"}`}
              data-review-block-button=""
              onClick={() =>
                beginTarget(
                  targetForBlock(block),
                  block.getBoundingClientRect(),
                )
              }
            >
              <Icon icon={MESSAGE_SQUARE_ICON} />
            </Button>
          ),
          host,
          block.dataset.blockId,
        ),
      )}
      {selectionControl === null ? null : (
        <button
          type="button"
          className="fixed z-30 inline-flex cursor-pointer items-center gap-1 rounded-full border border-edge bg-paper px-2 py-1 text-xs text-muted shadow-raised hover:border-accent hover:bg-surface hover:text-ink focus-visible:border-accent focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5"
          style={{
            top: `${selectionControl.top}px`,
            left: `${selectionControl.left}px`,
          }}
          aria-label="Comment on selected text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            beginTarget(selectionControl.target, { top: selectionControl.top });
            setSelectionControl(null);
          }}
        >
          <Icon icon={MESSAGE_SQUARE_ICON} />
          Comment
        </button>
      )}
      {feedbackHost === null
        ? null
        : createPortal(
            <span className="inline-flex items-center gap-1.5">
              {agentHealthLabel === null ? (
                identity !== null && agent.presence.connected ? (
                  <DelayedTooltip label="Agent session active">
                    <button
                      type="button"
                      className="inline-flex size-[1.85rem] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                      aria-label="Agent session active"
                      onClick={() => {
                        setIsOpen(true);
                        setTab("agent");
                      }}
                    >
                      <span
                        className="inline-flex size-2.5 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--diff-add-c)_34%,transparent)]"
                        aria-hidden="true"
                      >
                        <span className="size-1.5 rounded-full bg-[var(--diff-add-c)]" />
                      </span>
                    </button>
                  </DelayedTooltip>
                ) : null
              ) : (
                <AgentHealthAlert
                  label={agentHealthLabel}
                  tone={
                    runtimeSession?.authoritative === false
                      ? "warning"
                      : "danger"
                  }
                  onOpen={() => {
                    setIsOpen(true);
                    setTab("agent");
                  }}
                />
              )}
              <button
                type="button"
                className="inline-flex min-h-[1.875rem] cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-muted shadow-none hover:bg-surface hover:text-ink hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:inset-shadow-pressed aria-expanded:border-accent aria-expanded:bg-accent-wash aria-expanded:text-accent aria-expanded:shadow-raised [&>svg]:size-4"
                aria-expanded={isOpen}
                aria-controls="big-plan-feedback-rail"
                onClick={() => setIsOpen((current) => !current)}
              >
                <Icon icon={MESSAGE_SQUARE_ICON} />
                Feedback
                {drafts.length > 0 ? (
                  <Badge
                    size="compact"
                    tone="accent"
                    className="h-5 min-w-5 justify-center px-1 py-0 leading-none"
                  >
                    {drafts.length}
                  </Badge>
                ) : null}
              </button>
            </span>,
            feedbackHost,
          )}
      {isOpen ? (
        <aside
          id="big-plan-feedback-rail"
          className="fixed top-11 right-0 bottom-0 z-20 flex w-[min(22rem,100vw)] flex-col border-l border-edge bg-paper text-ink shadow-floating"
          aria-label="Feedback"
        >
          <div className="flex flex-none items-stretch border-b border-edge bg-paper">
            <div
              className="flex min-w-0 flex-1 items-stretch gap-1 pt-1.5 pl-2"
              role="tablist"
              aria-label="Feedback views"
              onKeyDown={handleFeedbackTabKeyDown}
            >
              <button
                id="review-tab-comments"
                type="button"
                className={FEEDBACK_TAB_CLASS}
                role="tab"
                aria-controls="review-panel-comments"
                aria-selected={tab === "comments"}
                tabIndex={tab === "comments" ? 0 : -1}
                onClick={() => setTab("comments")}
              >
                <Icon icon={MESSAGE_SQUARE_ICON} />
                Comments
                {drafts.length > 0 ? (
                  <Badge size="compact">{drafts.length}</Badge>
                ) : null}
              </button>
              <button
                id="review-tab-chat"
                type="button"
                className={FEEDBACK_TAB_CLASS}
                role="tab"
                aria-controls="review-panel-chat"
                aria-selected={tab === "chat"}
                tabIndex={tab === "chat" ? 0 : -1}
                onClick={() => setTab("chat")}
              >
                <Icon icon={MESSAGES_SQUARE_ICON} />
                Chat
              </button>
              {identity === null ? null : (
                <button
                  id="review-tab-agent"
                  type="button"
                  className={FEEDBACK_TAB_CLASS}
                  role="tab"
                  aria-controls="review-panel-agent"
                  aria-selected={tab === "agent"}
                  tabIndex={tab === "agent" ? 0 : -1}
                  onClick={() => setTab("agent")}
                >
                  <Icon icon={ACTIVITY_ICON} />
                  Agent
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="compactIcon"
              className="mr-2 ml-auto min-h-0 self-center"
              aria-label="Close feedback"
              onClick={() => setIsOpen(false)}
            >
              <Icon icon={X_ICON} />
            </Button>
          </div>
          {newerRevisionAvailable ? (
            <Card className="m-3 mb-0 border border-accent bg-accent-wash p-3 shadow-raised">
              <p className="m-0 text-sm font-semibold text-ink">
                A revised plan is ready.
              </p>
              <p className="mt-1 mb-0 text-xs text-muted">
                Reload to review the accepted revision. Threads keep their exact
                recorded addresses.
              </p>
              <Button
                variant="secondary"
                size="compact"
                className="mt-2"
                onClick={() => window.location.reload()}
              >
                Reload plan
              </Button>
            </Card>
          ) : null}
          {tab === "comments" ? (
            <div
              id="review-panel-comments"
              className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3"
              role="tabpanel"
              aria-labelledby="review-tab-comments"
            >
              {drafts.length === 0 ? (
                <div className="border-b border-edge pb-4 text-sm text-muted [&_p]:m-0 [&_p+p]:mt-2">
                  {sent.length > 0 ? (
                    <p>
                      {sent.length} comment{sent.length === 1 ? "" : "s"} sent
                      to the agent
                    </p>
                  ) : null}
                  <p>
                    {identity === null
                      ? "Reading offline: drafts stay in this browser until you start the local review runtime."
                      : "Select text to comment, or use a slide selector to select it all."}
                  </p>
                </div>
              ) : (
                <section>
                  <div className="mb-2 flex items-center gap-2">
                    <p className="m-0 text-xs font-bold uppercase tracking-caps text-subtle">
                      Staged
                    </p>
                    <Badge tone="secondary" size="compact" className="ml-auto">
                      {drafts.length}
                    </Badge>
                  </div>
                  <ol className="m-0 grid list-none gap-2 p-0 [&>li>*]:m-0 [&>li>*]:w-full [&>li>*]:max-w-none">
                    {drafts.map((comment) => (
                      <li key={comment.id}>
                        <StagedCard
                          comment={comment}
                          surface="rail"
                          associated={
                            associatedTarget !== null &&
                            targetAddress(associatedTarget) ===
                              targetAddress(comment.target)
                          }
                          collapsed={false}
                          expanded={expandedBodies.has(comment.id)}
                          onExpandBody={() =>
                            setExpandedBodies((current) =>
                              new Set(current).add(comment.id),
                            )
                          }
                          onMinimizeBody={() =>
                            setExpandedBodies((current) => {
                              const next = new Set(current);
                              next.delete(comment.id);
                              return next;
                            })
                          }
                          onUpdate={(body) => updateDraft(comment.id, body)}
                          onDelete={() =>
                            setPendingDelete({ kind: "comment", comment })
                          }
                          onJump={() => jumpTo(comment)}
                          onSubmit={() => void sendComments([comment])}
                          onAssociate={setAssociatedTarget}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {sent.length > 0 ? (
                <div>
                  <div className="mt-4 flex justify-end">
                    {unresolvedSent.some(
                      (comment) =>
                        threadProjections.get(comment.id)?.group === "ready",
                    ) ? (
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        onClick={() =>
                          setResolvedCommentIds(
                            new Set([
                              ...resolvedCommentIds,
                              ...unresolvedSent
                                .filter(
                                  (comment) =>
                                    threadProjections.get(comment.id)?.group ===
                                    "ready",
                                )
                                .map((comment) => comment.id),
                            ]),
                          )
                        }
                      >
                        Resolve all
                      </button>
                    ) : null}
                  </div>
                  {(
                    [
                      {
                        key: "needs-input",
                        label: "Respond",
                        glyph: TRIANGLE_ALERT_ICON,
                      },
                      {
                        key: "ready",
                        label: "Ready for review",
                        glyph: CHECK_ICON,
                      },
                      {
                        key: "working",
                        label: "Now working",
                        glyph: null,
                      },
                      {
                        key: "queued",
                        label: "Queued",
                        glyph: HOURGLASS_ICON,
                      },
                    ] as const
                  ).map(({ key, label, glyph }) => {
                    const comments = sentByGroup.get(key) ?? [];
                    if (comments.length === 0) return null;
                    return (
                      <section
                        key={key}
                        className={`mt-4 border-t border-edge pt-4 ${key === "working" ? "text-[var(--callout-note-c)]" : key === "needs-input" ? "text-[var(--callout-warning-c)]" : key === "ready" ? "text-accent" : "text-muted"}`}
                        data-review-thread-group={key}
                      >
                        <h3 className="m-0 mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-caps">
                          {key === "working" ? (
                            <span
                              className="inline-block size-3 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          ) : glyph === null ? null : (
                            <Icon icon={glyph} />
                          )}
                          {label}
                          <Badge
                            tone="secondary"
                            size="compact"
                            className="ml-auto"
                          >
                            {comments.length}
                          </Badge>
                        </h3>
                        {comments.map((comment) => {
                          const thread = threadProjections.get(comment.id);
                          if (thread === undefined) return null;
                          return (
                            <SentThread
                              key={comment.id}
                              comment={comment}
                              surface="rail"
                              associated={
                                associatedTarget !== null &&
                                targetAddress(associatedTarget) ===
                                  targetAddress(comment.target)
                              }
                              selected={selectedCommentId === comment.id}
                              identity={identity}
                              thread={thread}
                              expanded={threadIsOpen({
                                commentId: comment.id,
                                kind: "sent",
                                surface: "rail",
                              })}
                              resolved={false}
                              onToggle={() =>
                                toggleCommentThread({
                                  commentId: comment.id,
                                  kind: "sent",
                                  surface: "rail",
                                })
                              }
                              onResolve={() =>
                                toggleResolvedComment(comment.id)
                              }
                              onJump={() => jumpTo(comment)}
                              onAssociate={setAssociatedTarget}
                              onReplySent={setStatus}
                              onShowAgent={showAgentSetup}
                              onCancelRequest={(requestId) =>
                                void cancelRequest(requestId)
                              }
                              onDeleteQueued={() =>
                                setPendingDelete({ kind: "queued", comment })
                              }
                            />
                          );
                        })}
                      </section>
                    );
                  })}
                  {resolvedSent.length === 0 ? null : (
                    <details className="mt-4 border-t border-edge pt-4">
                      <summary className="cursor-pointer text-xs font-bold uppercase tracking-caps text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                        Resolved ({resolvedSent.length})
                      </summary>
                      {resolvedSent.map((comment) => {
                        const thread = threadProjections.get(comment.id);
                        if (thread === undefined) return null;
                        return (
                          <SentThread
                            key={comment.id}
                            comment={comment}
                            surface="rail"
                            associated={
                              associatedTarget !== null &&
                              targetAddress(associatedTarget) ===
                                targetAddress(comment.target)
                            }
                            selected={selectedCommentId === comment.id}
                            identity={identity}
                            thread={thread}
                            expanded={threadIsOpen({
                              commentId: comment.id,
                              kind: "sent",
                              surface: "rail",
                            })}
                            resolved
                            onToggle={() =>
                              toggleCommentThread({
                                commentId: comment.id,
                                kind: "sent",
                                surface: "rail",
                              })
                            }
                            onResolve={() => toggleResolvedComment(comment.id)}
                            onJump={() => jumpTo(comment)}
                            onAssociate={setAssociatedTarget}
                            onReplySent={setStatus}
                            onShowAgent={showAgentSetup}
                            onCancelRequest={(requestId) =>
                              void cancelRequest(requestId)
                            }
                            onDeleteQueued={() =>
                              setPendingDelete({ kind: "queued", comment })
                            }
                          />
                        );
                      })}
                    </details>
                  )}
                </div>
              ) : null}
              {drafts.length > 0 ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="outline"
                    size="compact"
                    className="border-danger text-danger hover:border-danger hover:text-danger"
                    onClick={() =>
                      setPendingDelete({ kind: "all", count: drafts.length })
                    }
                  >
                    <Icon icon={TRASH_2_ICON} />
                    Delete all comments
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "chat" ? (
            <div
              id="review-panel-chat"
              className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 grid content-start gap-3"
              role="tabpanel"
              aria-labelledby="review-tab-chat"
            >
              {identity === null ? (
                <Card className="border border-edge bg-surface p-3 shadow-none">
                  <p className="m-0 text-sm font-semibold text-ink">
                    Plan-wide chat needs the local runtime
                  </p>
                  <p className="mt-1 mb-0 text-xs text-muted">
                    Open this file with `big-plan review &lt;plan.mdx&gt;`.
                    Browser drafts remain safe here.
                  </p>
                </Card>
              ) : (
                <>
                  <div className="-m-3 mb-0 border-b border-edge bg-well p-3">
                    <div className="flex items-center gap-2">
                      <label
                        className="text-sm font-bold uppercase tracking-caps text-muted"
                        htmlFor="review-agent-chat"
                      >
                        Plan-wide chat
                      </label>
                      <AgentStatePill status={agentStatus} />
                    </div>
                    <Textarea
                      id="review-agent-chat"
                      className="mt-2 min-h-20! bg-input!"
                      value={chatBody}
                      maxLength={BODY_LIMIT}
                      placeholder="Ask about the plan as a whole…"
                      onChange={(event) => setChatBody(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          (event.metaKey || event.ctrlKey) &&
                          event.key === "Enter"
                        ) {
                          event.preventDefault();
                          void sendChat();
                        }
                      }}
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <DelayedTooltip label={`Send · ${MODIFIER_SHORTCUT}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={chatBody.trim() === "" || isSendingChat}
                          onClick={() => void sendChat()}
                        >
                          {isSendingChat ? "Sending…" : "Send"}
                        </Button>
                      </DelayedTooltip>
                    </div>
                  </div>
                  {chatRequests.length === 0 ? (
                    <p className="m-0 text-xs text-subtle">
                      No plan-wide questions yet.
                    </p>
                  ) : (
                    <ol className="m-0 grid list-none gap-3 p-0">
                      {chatRequests.map((request) => {
                        const response = agent.responses.find(
                          (candidate) =>
                            candidate.requestId === request.requestId &&
                            candidate.kind === "chat",
                        );
                        return (
                          <ChatExchange
                            key={request.requestId}
                            request={request}
                            response={response}
                            identity={identity}
                            status={statusForRequest(request, "chat")}
                            activity={activityForRequest(request)}
                            onStatus={setStatus}
                            onShowAgent={showAgentSetup}
                            onCancelRequest={(requestId) =>
                              void cancelRequest(requestId)
                            }
                          />
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </div>
          ) : null}
          {tab === "agent" && identity !== null ? (
            <div
              id="review-panel-agent"
              className="review-feedback-panel min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3 grid content-start gap-3"
              role="tabpanel"
              aria-labelledby="review-tab-agent"
            >
              <AgentConnectionPanel
                activity={currentAgentActivity}
                connected={agent.presence.connected}
                heartbeatAt={agent.presence.updatedAtMs ?? 0}
                connectionLog={agent.connectionLog}
                recoveryPrompt={agent.recoveryPrompt}
                agentCommand={
                  agent.agentCommand ||
                  `node bin/big-plan.mjs agent '${agent.plan || runtimeSession?.plan || "<plan.mdx>"}'`
                }
                replacementUrl={
                  runtimeSession?.authoritative === false
                    ? (runtimeSession.latestReviewUrl ?? null)
                    : null
                }
                isReadOnly={runtimeSession?.authoritative === false}
                onViewRequest={viewAgentRequest}
              />
            </div>
          ) : null}
          {tab === "comments" ? (
            <div className="review-feedback-status flex flex-none flex-col items-stretch gap-2 border-t border-edge bg-paper p-3 text-xs text-subtle">
              <Button
                className="w-full px-3! py-2! text-xs"
                size="sm"
                disabled={
                  drafts.length === 0 ||
                  isSending ||
                  runtimeSession?.authoritative === false
                }
                onClick={() => void sendComments(drafts)}
              >
                {isSending ? "Sending…" : "Send all comments to agent"}
              </Button>
              {identity === null ? (
                <p className="m-0 text-xs text-support" role="status">
                  {status}
                </p>
              ) : (
                <div role="status" aria-live="polite">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="m-0 min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left text-xs font-semibold text-ink hover:underline hover:underline-offset-[0.16em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      aria-label={`${agentStatus.headline} — view Agent tab`}
                      onClick={() => setTab("agent")}
                    >
                      {agentStatus.headline}
                    </button>
                    <Badge tone="secondary" size="compact">
                      {agentStatus.label}
                    </Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-support">{status}</p>
                </div>
              )}
            </div>
          ) : null}
        </aside>
      ) : null}
      {drafts.map((comment) => {
        const host = threadHosts.get(comment.id);
        if (host === undefined) return null;
        return createPortal(
          <StagedCard
            comment={comment}
            surface="thread"
            associated={
              associatedTarget !== null &&
              targetAddress(associatedTarget) === targetAddress(comment.target)
            }
            collapsed={
              !threadIsOpen({
                commentId: comment.id,
                kind: "draft",
                surface: "inline",
              })
            }
            expanded={expandedBodies.has(comment.id)}
            onCollapse={() =>
              toggleCommentThread({
                commentId: comment.id,
                kind: "draft",
                surface: "inline",
              })
            }
            onExpandBody={() =>
              setExpandedBodies((current) => new Set(current).add(comment.id))
            }
            onMinimizeBody={() =>
              setExpandedBodies((current) => {
                const next = new Set(current);
                next.delete(comment.id);
                return next;
              })
            }
            onUpdate={(body) => updateDraft(comment.id, body)}
            onDelete={() => setPendingDelete({ kind: "comment", comment })}
            onJump={() => jumpTo(comment)}
            onSubmit={() => void sendComments([comment])}
            onAssociate={setAssociatedTarget}
          />,
          host,
          comment.id,
        );
      })}
      {sent.map((comment) => {
        const host = threadHosts.get(comment.id);
        const thread = threadProjections.get(comment.id);
        if (host === undefined || thread === undefined) return null;
        return createPortal(
          <SentThread
            comment={comment}
            surface="thread"
            associated={
              associatedTarget !== null &&
              targetAddress(associatedTarget) === targetAddress(comment.target)
            }
            selected={selectedCommentId === comment.id}
            identity={identity}
            thread={thread}
            expanded={threadIsOpen({
              commentId: comment.id,
              kind: "sent",
              surface: "inline",
            })}
            resolved={resolvedCommentIds.has(comment.id)}
            onToggle={() =>
              toggleCommentThread({
                commentId: comment.id,
                kind: "sent",
                surface: "inline",
              })
            }
            onResolve={() => toggleResolvedComment(comment.id)}
            onJump={() => jumpTo(comment)}
            onAssociate={setAssociatedTarget}
            onReplySent={setStatus}
            onShowAgent={showAgentSetup}
            onCancelRequest={(requestId) => void cancelRequest(requestId)}
            onDeleteQueued={() => setPendingDelete({ kind: "queued", comment })}
          />,
          host,
          `sent-${comment.id}`,
        );
      })}
      {compose === null ? null : inlineComposeHost === null ? (
        <CommentComposer
          key={
            compose.target.type === "document"
              ? "document"
              : compose.target.blockId
          }
          compose={compose}
          inline={false}
          body={composeBody}
          submitRightAway={submitRightAway}
          onCancel={() => {
            setCompose(null);
            setComposeBody("");
          }}
          onBodyChange={setComposeBody}
          onSave={saveComment}
          onSubmitRightAwayChange={setSubmitRightAway}
        />
      ) : (
        createPortal(
          <CommentComposer
            key={
              compose.target.type === "document"
                ? "document"
                : compose.target.blockId
            }
            compose={compose}
            inline
            body={composeBody}
            submitRightAway={submitRightAway}
            onCancel={() => {
              setCompose(null);
              setComposeBody("");
            }}
            onBodyChange={setComposeBody}
            onSave={saveComment}
            onSubmitRightAwayChange={setSubmitRightAway}
          />,
          inlineComposeHost,
        )
      )}
      <AlertDialog
        open={pendingCompose !== null}
        title="Finish your draft comment?"
        description="You have a draft comment that will be lost if you start a new one."
        cancelLabel="Return to draft"
        actionLabel="Discard"
        onCancel={() => {
          setPendingCompose(null);
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLTextAreaElement>(
                'textarea[aria-label="Add a comment"]',
              )
              ?.focus(),
          );
        }}
        onAction={() => {
          if (pendingCompose === null) return;
          setCompose(pendingCompose);
          setComposeBody("");
          setPendingCompose(null);
        }}
      />
      <AlertDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === "all"
            ? "Delete all comments?"
            : pendingDelete?.kind === "queued"
              ? "Delete queued comment?"
              : "Delete comment?"
        }
        description={
          pendingDelete?.kind === "all"
            ? `This permanently removes all ${pendingDelete.count} staged ${pendingDelete.count === 1 ? "comment" : "comments"}. This action cannot be undone.`
            : pendingDelete?.kind === "queued"
              ? "This removes the comment before the agent picks it up. This action cannot be undone."
              : "This permanently removes your staged comment. This action cannot be undone."
        }
        actionLabel={pendingDelete?.kind === "all" ? "Delete all" : "Delete"}
        onCancel={() => setPendingDelete(null)}
        onAction={() => {
          if (pendingDelete?.kind === "comment") {
            deleteDraft(pendingDelete.comment.id);
          } else if (pendingDelete?.kind === "all") {
            deleteAllDrafts();
          } else if (pendingDelete?.kind === "queued") {
            void deleteQueuedComment(pendingDelete.comment.id);
          }
        }}
      />
    </>
  );
};

const mount = document.createElement("div");
mount.id = "big-plan-review-root";
document.body.append(mount);
createRoot(mount).render(<ReviewKernel />);
