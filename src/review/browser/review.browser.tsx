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
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import { PENCIL_ICON } from "../../icons/lucide/pencil.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import type { CommentTarget, ReviewComment } from "../comment.js";
import { parseCommentMarkdownLine } from "../comment-markdown.js";
import { deriveAgentStatus, type AgentStatus } from "../thread-status.js";
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
  | { readonly kind: "all"; readonly count: number };

type RuntimeIdentity = {
  readonly planId: string;
  readonly sessionId: string;
  readonly token: string;
};

type ReviewSnapshot = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sent: ReadonlyArray<ReviewComment>;
};

type AgentOutcome = {
  readonly commentId: string;
  readonly state: "changed" | "question" | "outside";
  readonly message: string;
  readonly changeTargets: ReadonlyArray<string>;
};

type AgentRequest = {
  readonly requestId: string;
  readonly sourceRevision: string;
  readonly claimedFromRevision?: string;
  readonly claimedAt?: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly body?: string;
  readonly commentId?: string;
};

type AgentResponse = {
  readonly requestId: string;
  readonly sourceRevision: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
  readonly message?: string;
};

type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly updatedAtMs?: number;
};

type AgentSnapshot = {
  readonly sourceRevision: string;
  readonly presence: AgentPresence;
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly responses: ReadonlyArray<AgentResponse>;
};

type ProgressEvent = {
  readonly requestId?: string;
  readonly atMs?: number;
  readonly seq: number;
  readonly step: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  readonly detail?: string;
};

type DiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

type DiffLocation = {
  readonly status: "changed" | "added" | "removed";
  readonly label: string;
  readonly section: string;
  readonly runs: ReadonlyArray<DiffRun>;
};

type RuntimeSession = {
  readonly plan: string;
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

/** Keeps a viewport-anchored composer clear of contextual comment cards. */
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

const isComment = (value: unknown): value is ReviewComment => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return (
    typeof record.id === "string" &&
    typeof record.body === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.target === "object" &&
    record.target !== null
  );
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSnapshot = (value: unknown): ReviewSnapshot => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { drafts: [], sent: [] };
  }
  const record = value as Readonly<Record<string, unknown>>;
  return {
    drafts: Array.isArray(record.drafts) ? record.drafts.filter(isComment) : [],
    sent: Array.isArray(record.sent) ? record.sent.filter(isComment) : [],
  };
};

const emptyAgentSnapshot = (): AgentSnapshot => ({
  sourceRevision: "",
  presence: { connected: false, state: "waiting" },
  requests: [],
  responses: [],
});

const parseAgentSnapshot = (value: unknown): AgentSnapshot => {
  if (!isRecord(value)) return emptyAgentSnapshot();
  const requests = Array.isArray(value.requests)
    ? value.requests.flatMap((request): ReadonlyArray<AgentRequest> => {
        if (
          !isRecord(request) ||
          typeof request.requestId !== "string" ||
          typeof request.sourceRevision !== "string" ||
          typeof request.createdAt !== "string" ||
          (request.kind !== "feedback" &&
            request.kind !== "reply" &&
            request.kind !== "chat")
        ) {
          return [];
        }
        return [
          {
            requestId: request.requestId,
            sourceRevision: request.sourceRevision,
            createdAt: request.createdAt,
            kind: request.kind,
            ...(typeof request.claimedFromRevision === "string"
              ? { claimedFromRevision: request.claimedFromRevision }
              : {}),
            ...(typeof request.claimedAt === "string"
              ? { claimedAt: request.claimedAt }
              : {}),
            ...(typeof request.body === "string" ? { body: request.body } : {}),
            ...(typeof request.commentId === "string"
              ? { commentId: request.commentId }
              : {}),
          },
        ];
      })
    : [];
  const responses = Array.isArray(value.responses)
    ? value.responses.flatMap((response): ReadonlyArray<AgentResponse> => {
        if (
          !isRecord(response) ||
          typeof response.requestId !== "string" ||
          typeof response.sourceRevision !== "string" ||
          typeof response.createdAt !== "string" ||
          (response.kind !== "feedback" &&
            response.kind !== "reply" &&
            response.kind !== "chat")
        ) {
          return [];
        }
        const outcomes = Array.isArray(response.outcomes)
          ? response.outcomes.flatMap(
              (outcome): ReadonlyArray<AgentOutcome> => {
                if (
                  !isRecord(outcome) ||
                  typeof outcome.commentId !== "string" ||
                  typeof outcome.message !== "string" ||
                  (outcome.state !== "changed" &&
                    outcome.state !== "question" &&
                    outcome.state !== "outside")
                ) {
                  return [];
                }
                return [
                  {
                    commentId: outcome.commentId,
                    state: outcome.state,
                    message: outcome.message,
                    changeTargets: Array.isArray(outcome.changeTargets)
                      ? outcome.changeTargets.filter(
                          (target): target is string =>
                            typeof target === "string",
                        )
                      : [],
                  },
                ];
              },
            )
          : [];
        return [
          {
            requestId: response.requestId,
            sourceRevision: response.sourceRevision,
            createdAt: response.createdAt,
            kind: response.kind,
            outcomes,
            ...(typeof response.message === "string"
              ? { message: response.message }
              : {}),
          },
        ];
      })
    : [];
  const presence = isRecord(value.presence)
    ? {
        connected: value.presence.connected === true,
        state:
          value.presence.state === "working"
            ? ("working" as const)
            : ("waiting" as const),
        ...(typeof value.presence.requestId === "string"
          ? { requestId: value.presence.requestId }
          : {}),
        ...(typeof value.presence.updatedAtMs === "number"
          ? { updatedAtMs: value.presence.updatedAtMs }
          : {}),
      }
    : { connected: false, state: "waiting" as const };
  return {
    sourceRevision:
      typeof value.sourceRevision === "string" ? value.sourceRevision : "",
    presence,
    requests,
    responses,
  };
};

const parseProgress = (value: unknown): ReadonlyArray<ProgressEvent> => {
  if (!isRecord(value) || !Array.isArray(value.events)) return [];
  return value.events.flatMap((event): ReadonlyArray<ProgressEvent> => {
    if (
      !isRecord(event) ||
      typeof event.seq !== "number" ||
      typeof event.step !== "string" ||
      (event.state !== "waiting" &&
        event.state !== "live" &&
        event.state !== "done" &&
        event.state !== "failed")
    ) {
      return [];
    }
    return [
      {
        seq: event.seq,
        step: event.step,
        state: event.state,
        ...(typeof event.requestId === "string"
          ? { requestId: event.requestId }
          : {}),
        ...(typeof event.atMs === "number" ? { atMs: event.atMs } : {}),
        ...(typeof event.detail === "string" ? { detail: event.detail } : {}),
      },
    ];
  });
};

const parseDiffLocations = (value: unknown): ReadonlyArray<DiffLocation> => {
  if (!isRecord(value) || !Array.isArray(value.locations)) return [];
  return value.locations.flatMap((location): ReadonlyArray<DiffLocation> => {
    if (
      !isRecord(location) ||
      (location.status !== "changed" &&
        location.status !== "added" &&
        location.status !== "removed") ||
      typeof location.label !== "string" ||
      typeof location.section !== "string" ||
      !Array.isArray(location.runs)
    ) {
      return [];
    }
    const runs = location.runs.flatMap((run): ReadonlyArray<DiffRun> => {
      if (
        !isRecord(run) ||
        (run.op !== "same" && run.op !== "del" && run.op !== "ins") ||
        typeof run.text !== "string"
      ) {
        return [];
      }
      return [{ op: run.op, text: run.text }];
    });
    return [
      {
        status: location.status,
        label: location.label,
        section: location.section,
        runs,
      },
    ];
  });
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
  const selector = '[data-block-id]:not([data-block-kind="part"])';
  const startBlock = parentElementFor(
    range.startContainer,
  )?.closest<HTMLElement>(selector);
  const endBlock = parentElementFor(range.endContainer)?.closest<HTMLElement>(
    selector,
  );
  if (
    startBlock == null ||
    startBlock !== endBlock ||
    startBlock.closest("#big-plan-review-root") !== null
  ) {
    return null;
  }
  const quote = selection.toString();
  if (quote.trim() === "" || quote.length > 400) return null;
  const before = document.createRange();
  before.selectNodeContents(startBlock);
  before.setEnd(range.startContainer, range.startOffset);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    target: {
      type: "selection",
      ...blockIdentity(startBlock),
      start: before.toString().length,
      end: before.toString().length + quote.length,
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

const targetAddress = (target: CommentTarget): string => {
  if (target.type === "document") return "document";
  if (target.type === "selection") {
    return `selection:${target.blockId}:${target.start}:${target.end}`;
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
  const block = targetElement(target);
  if (block === null) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node !== null) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && target.start <= offset + length) {
      range.setStart(node, Math.max(0, target.start - offset));
      startSet = true;
    }
    if (startSet && target.end <= offset + length) {
      range.setEnd(node, Math.max(0, target.end - offset));
      return range;
    }
    offset += length;
    node = walker.nextNode();
  }
  return null;
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
        container.append(host);
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
  drafts: ReadonlyArray<ReviewComment>,
  isOpen: boolean,
): ReadonlyMap<string, HTMLDivElement> => {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(
    new Map(),
  );
  const isWide = useWide();

  useEffect(() => {
    if (isOpen || !isWide) {
      setHosts(new Map());
      return;
    }
    const mounted = new Map<string, HTMLDivElement>();
    for (const comment of drafts) {
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
      const threadTopInset = 12;
      const threadWidth = 17 * 16;
      const lastBottomByAnchor = new Map<HTMLElement, number>();
      for (const comment of drafts) {
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
        const previousBottom = lastBottomByAnchor.get(anchor) ?? 0;
        const top = Math.max(previousBottom, desiredTop);
        host.style.top = `${top}px`;
        host.style.left = `${Math.max(
          edge + window.scrollX,
          Math.min(
            anchorRect.right + window.scrollX - 12,
            window.scrollX + viewportWidth - threadWidth - edge,
          ),
        )}px`;
        lastBottomByAnchor.set(anchor, top + cardHeight + 8);
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
  }, [drafts, isOpen, isWide]);

  return hosts;
};

const CommentComposer = ({
  compose,
  inline,
  onCancel,
  onSave,
}: {
  readonly compose: ComposeState;
  readonly inline: boolean;
  readonly onCancel: () => void;
  readonly onSave: (body: string, submitRightAway: boolean) => void;
}) => {
  const [body, setBody] = useState("");
  const [submitRightAway, setSubmitRightAway] = useState(true);
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>({
    top: compose.top,
    left: compose.left,
  });
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (inline) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = composerRef.current?.getBoundingClientRect();
        if (rect === undefined) return;
        const obstacles = Array.from(
          document.querySelectorAll<HTMLElement>("[data-review-thread-side]"),
          (node) => node.getBoundingClientRect(),
        ).filter((obstacle) => obstacle.width > 0 && obstacle.height > 0);
        const next = floatingComposerPosition({
          preferred: { top: compose.top, left: compose.left },
          width: rect.width,
          height: rect.height,
          obstacles,
        });
        setFloatingPosition((current) =>
          current.top === next.top && current.left === next.left
            ? current
            : next,
        );
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
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
          ? "review-comment-composer-inline relative z-auto mb-6 w-full max-w-lg border border-edge bg-paper! p-3 text-ink shadow-floating"
          : "review-comment-composer-floating fixed z-30 w-[min(17rem,calc(100vw-2rem))] border border-edge bg-paper! p-3 text-ink shadow-floating"
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
        onChange={(event) => setBody(event.target.value)}
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
          onClick={() => setSubmitRightAway((current) => !current)}
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
              className="invisible pointer-events-none absolute top-[calc(100%+0.35rem)] right-0 z-50 w-max rounded-sm bg-ink px-2 py-1 text-2xs font-medium text-bg opacity-0 transition-[opacity,visibility] duration-0 group-hover:visible group-hover:opacity-100 group-hover:delay-1000 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:delay-1000"
            >
              {MODIFIER_SHORTCUT}
            </span>
          </span>
        </div>
      </div>
    </Card>
  );
};

const StagedCard = ({
  comment,
  surface,
  associated,
  collapsed,
  expanded,
  onCollapse,
  onExpandBody,
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
      <button
        type="button"
        className={`review-staged-collapsed-${surface} flex min-w-0 w-full max-w-[17rem] cursor-pointer items-center gap-1.5 rounded-md border border-edge bg-raised px-2 py-1 text-xs text-muted shadow-raised transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted`}
        onClick={onCollapse}
        onPointerEnter={() => setAssociated(true)}
        onPointerLeave={() => setAssociated(false)}
        onFocus={() => setAssociated(true)}
        onBlur={() => setAssociated(false)}
        data-review-comment-ui=""
        data-review-associated={associated ? "true" : undefined}
        aria-label={`Expand staged comment on ${targetLabel(comment.target)}`}
      >
        {surface === "thread" ? (
          <Badge
            size="compact"
            shape="badge"
            tone="secondary"
            className="leading-normal tracking-caps"
          >
            STAGED
          </Badge>
        ) : null}
        <span>
          {surface === "rail" ? targetLabel(comment.target) : comment.body}
        </span>
      </button>
    );
  }
  const long = comment.body.length > LONG_COMMENT;
  const visibleBody =
    long && !expanded
      ? `${comment.body.slice(0, LONG_COMMENT).trimEnd()}…`
      : comment.body;
  return (
    <Card
      className={`review-staged-card w-full max-w-[17rem] border border-edge transition-shadow data-[review-associated=true]:border-[var(--annotation-c)] data-[review-associated=true]:shadow-lifted ${surface === "rail" ? "bg-surface" : "bg-comment-body!"}`}
      density={surface === "rail" ? "dense" : "compact"}
      elevation={surface === "rail" ? "none" : "floating"}
      onPointerEnter={() => setAssociated(true)}
      onPointerLeave={() => setAssociated(false)}
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
      <div
        className={`review-staged-meta flex min-w-0 items-center gap-2 ${surface === "thread" ? "-mx-3 -mt-3 mb-3 rounded-t-lg border-b border-edge bg-comment-toolbar!" : ""}`}
        style={surface === "thread" ? { padding: "3px 5px" } : undefined}
      >
        {surface === "rail" ? (
          <button
            type="button"
            className="review-staged-target min-w-0 flex-1 cursor-pointer [overflow-wrap:anywhere] border-0 bg-transparent p-0 text-left text-2xs font-semibold uppercase leading-normal tracking-caps text-ink hover:underline focus-visible:underline"
            onClick={onJump}
            title="Jump to this target"
          >
            {targetLabel(comment.target, true)}
          </button>
        ) : (
          <>
            <Badge
              size="compact"
              shape="badge"
              tone="secondary"
              className="leading-normal tracking-caps"
            >
              STAGED
            </Badge>
            <time className="text-xs text-muted" dateTime={comment.createdAt}>
              {threadTime(comment.createdAt)}
            </time>
          </>
        )}
        <div className="review-staged-actions ml-auto flex items-center gap-1 [&_svg]:size-3.5">
          {surface === "thread" ? (
            <Button
              variant="ghost"
              size="compactIcon"
              className="hover:bg-edge! hover:text-ink hover:shadow-raised focus:outline-1 focus:outline-offset-2 focus:outline-accent"
              aria-label="Minimize staged comment"
              onClick={onCollapse}
            >
              <Icon icon={MINIMIZE_2_ICON} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="compactIcon"
            className="hover:bg-edge! hover:text-ink hover:shadow-raised focus:outline-1 focus:outline-offset-2 focus:outline-accent"
            aria-label="Edit staged comment"
            onClick={() => {
              setEditBody(comment.body);
              setIsEditing(true);
            }}
          >
            <Icon icon={PENCIL_ICON} />
          </Button>
          <Button
            variant="ghost"
            size="compactIcon"
            className="hover:border-danger! hover:bg-[var(--callout-danger-bg)]! hover:text-danger focus:outline-1 focus:outline-offset-2 focus:outline-accent"
            aria-label="Delete staged comment"
            onClick={onDelete}
          >
            <Icon icon={TRASH_2_ICON} />
          </Button>
        </div>
      </div>
      {isEditing ? (
        <>
          <Textarea
            ref={editRef}
            className="mt-2 bg-well"
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
                className="invisible pointer-events-none absolute top-[calc(100%+0.35rem)] right-0 z-50 w-max rounded-sm bg-ink px-2 py-1 text-2xs font-medium text-bg opacity-0 transition-[opacity,visibility] duration-0 group-hover:visible group-hover:opacity-100 group-hover:delay-1000 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:delay-1000"
              >
                {MODIFIER_SHORTCUT}
              </span>
            </span>
          </div>
        </>
      ) : (
        <MarkdownBody
          body={visibleBody}
          className="review-staged-body mt-2 [overflow-wrap:anywhere] text-xs text-ink [&_p]:m-0 [&_p+p]:mt-2"
        />
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
          <Button
            variant="accentOutline"
            size="micro"
            className={
              surface === "rail"
                ? "border-edge bg-transparent text-2xs text-subtle hover:border-edge-strong hover:bg-surface hover:text-muted"
                : undefined
            }
            onClick={onSubmit}
          >
            {surface === "rail" ? "Send this" : "Submit Now"}
          </Button>
        </div>
      )}
    </Card>
  );
};

const SentThread = ({
  comment,
  identity,
  agent,
  onJump,
  onAssociate,
  onReplySent,
}: {
  readonly comment: ReviewComment;
  readonly identity: RuntimeIdentity | null;
  readonly agent: AgentSnapshot;
  readonly onJump: () => void;
  readonly onAssociate: (target: CommentTarget | null) => void;
  readonly onReplySent: (message: string) => void;
}) => {
  const [locations, setLocations] =
    useState<ReadonlyArray<DiffLocation> | null>(null);
  const [diffError, setDiffError] = useState("");
  const [reply, setReply] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const response = [...agent.responses]
    .reverse()
    .find((candidate) =>
      candidate.outcomes.some((outcome) => outcome.commentId === comment.id),
    );
  const outcome = response?.outcomes.find(
    (candidate) => candidate.commentId === comment.id,
  );
  const request = agent.requests.find(
    (candidate) => candidate.requestId === response?.requestId,
  );
  const targetPresent = targetElement(comment.target) !== null;
  const outcomeLabel =
    outcome?.state === "changed"
      ? "Changed"
      : outcome?.state === "question"
        ? "Needs your answer"
        : outcome?.state === "outside"
          ? "Outside this plan"
          : "Waiting for agent";

  const loadDiff = async () => {
    if (identity === null || request === undefined || response === undefined)
      return;
    try {
      const value = await requestJson({
        path: `/api/revision-diff?from=${encodeURIComponent(request.claimedFromRevision ?? request.sourceRevision)}&to=${encodeURIComponent(response.sourceRevision)}`,
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

  return (
    <Card
      className="mt-3 border border-edge bg-surface p-3 shadow-raised"
      onPointerEnter={() => onAssociate(comment.target)}
      onPointerLeave={() => onAssociate(null)}
      onFocus={() => onAssociate(comment.target)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onAssociate(null);
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left text-2xs font-semibold uppercase tracking-caps text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          onClick={onJump}
        >
          {targetLabel(comment.target, true)}
        </button>
        <Badge tone="secondary" size="compact">
          {outcomeLabel}
        </Badge>
      </div>
      <p className="mt-2 mb-0 text-sm text-ink">{comment.body}</p>
      {!targetPresent ? (
        <p className="mt-3 mb-0 rounded-md bg-[var(--callout-warning-bg)] p-2 text-xs text-[var(--callout-warning-ink)]">
          Original target unavailable in this revision. This thread keeps its
          recorded address; Big Plan did not guess a replacement.
        </p>
      ) : null}
      {outcome === undefined ? (
        <p className="mt-3 mb-0 text-xs text-subtle">
          Waiting for the coding agent to claim this request.
        </p>
      ) : (
        <div className="mt-3 border-t border-edge pt-3">
          <p className="m-0 text-xs font-semibold text-ink">Agent</p>
          <p className="mt-1 mb-0 text-sm text-muted">{outcome.message}</p>
          {outcome.state === "changed" && request !== undefined ? (
            <Button
              variant="ghost"
              size="compact"
              className="mt-2"
              onClick={() => void loadDiff()}
            >
              What changed
            </Button>
          ) : null}
        </div>
      )}
      {locations === null ? null : (
        <div className="mt-3 grid gap-2" aria-label="Revision changes">
          {locations.length === 0 ? (
            <p className="m-0 text-xs text-subtle">
              No authored block changes were found between these revisions.
            </p>
          ) : (
            locations.slice(0, 4).map((location, index) => (
              <div
                key={`${location.status}-${location.label}-${index}`}
                className="min-w-0 rounded-md border border-edge p-2 text-xs"
              >
                <p className="m-0 font-semibold text-ink">
                  {location.status} · {location.label}
                </p>
                <p className="mt-1 mb-0 min-w-0 break-words text-muted">
                  {location.runs.map((run, runIndex) =>
                    run.op === "del" ? (
                      <del
                        key={runIndex}
                        className="bg-[var(--diff-remove-bg)] text-[var(--diff-remove-c)]"
                      >
                        {run.text}
                      </del>
                    ) : run.op === "ins" ? (
                      <ins
                        key={runIndex}
                        className="bg-[var(--diff-add-bg)] text-[var(--diff-add-c)] no-underline"
                      >
                        {run.text}
                      </ins>
                    ) : (
                      <span key={runIndex}>{run.text}</span>
                    ),
                  )}
                </p>
              </div>
            ))
          )}
        </div>
      )}
      {diffError === "" ? null : (
        <p className="mt-2 mb-0 text-xs text-danger">{diffError}</p>
      )}
      {identity === null ? null : (
        <div className="mt-3 border-t border-edge pt-3">
          <label
            className="text-xs font-medium text-ink"
            htmlFor={`reply-${comment.id}`}
          >
            Reply
          </label>
          <Textarea
            id={`reply-${comment.id}`}
            className="mt-1 min-h-20"
            value={reply}
            maxLength={BODY_LIMIT}
            placeholder="Continue this thread…"
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void sendReply();
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="compact"
              disabled={reply.trim() === "" || isReplying}
              onClick={() => void sendReply()}
            >
              {isReplying ? "Sending…" : "Reply"}
            </Button>
          </div>
        </div>
      )}
    </Card>
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
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [selectionControl, setSelectionControl] =
    useState<SelectionControlState | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<FeedbackTab>("comments");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatBody, setChatBody] = useState("");
  const [agent, setAgent] = useState<AgentSnapshot>(emptyAgentSnapshot);
  const [progress, setProgress] = useState<ReadonlyArray<ProgressEvent>>([]);
  const [runtimeSession, setRuntimeSession] = useState<RuntimeSession | null>(
    null,
  );
  const [pollFailures, setPollFailures] = useState(0);
  const [statusNowMs, setStatusNowMs] = useState(Date.now());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expandedBodies, setExpandedBodies] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [associatedTarget, setAssociatedTarget] =
    useState<CommentTarget | null>(null);
  const [associationActive, setAssociationActive] = useState(false);
  const [status, setStatus] = useState(
    identity === null
      ? "Reading offline: drafts stay in this browser."
      : "Loading review…",
  );
  const reviewComments = useMemo(() => [...drafts, ...sent], [drafts, sent]);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());
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
    if (associatedTarget === null || associatedTarget.type === "selection") {
      return undefined;
    }
    const target = targetElement(associatedTarget);
    const associatedElement =
      associatedTarget.type === "block" && associatedTarget.kind === "slide"
        ? (target?.closest<HTMLElement>("[data-slide], [data-quick-summary]") ??
          target)
        : target;
    if (associatedElement === null || associatedElement === undefined) {
      return undefined;
    }
    associatedElement.dataset.reviewCommentAssociated = "";
    return () => {
      delete associatedElement.dataset.reviewCommentAssociated;
    };
  }, [associatedTarget]);

  useEffect(() => {
    const marked = new Set<HTMLElement>();
    const entries = reviewComments.flatMap((comment) => {
      const element = targetElement(comment.target);
      if (element === null) return [];
      if (comment.target.type !== "selection") {
        element.dataset.reviewHasComment = "";
        marked.add(element);
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
      if (
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
        const session = await requestJson({ path: "/api/session", identity });
        if (
          typeof session !== "object" ||
          session === null ||
          !("sessionId" in session) ||
          session.sessionId !== identity.sessionId
        ) {
          throw new Error("This page is not connected to its review runtime.");
        }
        if (
          isRecord(session) &&
          "plan" in session &&
          typeof session.plan === "string"
        ) {
          setRuntimeSession({ plan: session.plan });
        }
        const snapshot = parseSnapshot(
          await requestJson({ path: "/api/drafts", identity }),
        );
        if (current) {
          setDrafts(snapshot.drafts);
          setSent(snapshot.sent);
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
        body: { drafts, activeDraft: "", resolvedCommentIds: [] },
      }),
    ).catch((error: unknown) => setStatus(errorMessage(error)));
  }, [drafts, identity, isHydrated, planId, serializeRuntimeWrite]);

  useEffect(() => {
    if (identity === null) return;
    let current = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [agentValue, progressValue] = await Promise.all([
          requestJson({ path: "/api/agent", identity }),
          requestJson({ path: "/api/progress", identity }),
        ]);
        if (current) {
          setAgent(parseAgentSnapshot(agentValue));
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
  }, [identity]);

  useEffect(() => {
    if (compose !== null) return;
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
  }, [compose]);

  const beginTarget = useCallback(
    (target: CommentTarget, rect: Pick<DOMRect, "top">) => {
      setCompose(
        (current) =>
          current ??
          (() => {
            const targetRect = targetElement(target)?.getBoundingClientRect();
            const composerWidth = 17 * 16;
            const edge = 24;
            const overlap = 12;
            const viewportWidth = document.documentElement.clientWidth;
            return {
              target,
              top: Math.max(56, Math.min(rect.top, window.innerHeight - 360)),
              left: Math.max(
                edge,
                Math.min(
                  (targetRect?.right ?? viewportWidth) - overlap,
                  viewportWidth - composerWidth - edge,
                ),
              ),
            };
          })(),
      );
    },
    [],
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
  const jumpTo = (comment: ReviewComment) =>
    targetElement(comment.target)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
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
      setAgent(
        parseAgentSnapshot(await requestJson({ path: "/api/agent", identity })),
      );
      setStatus("Plan question sent to the coding agent.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsSendingChat(false);
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
    runtime:
      identity === null ? "static" : pollFailures >= 2 ? "offline" : "online",
    request:
      latestRequest === undefined
        ? "none"
        : latestResponse === undefined
          ? "pending"
          : "answered",
    agentConnected: agent.presence.connected,
    pickedUp:
      latestRequest?.claimedAt !== undefined || requestProgress.length > 0,
    ...(lastAgentSignalAtMs > 0 ? { lastAgentSignalAtMs } : {}),
    ...(failure === undefined ? {} : { failure }),
    nowMs: statusNowMs,
  });
  const agentActivity = requestProgress
    .filter((event) => event.state !== "waiting")
    .filter(
      (event, index, events) =>
        index === 0 ||
        event.step !== events[index - 1]?.step ||
        event.state !== events[index - 1]?.state,
    )
    .slice(-8)
    .reverse();
  const chatRequests = agent.requests.filter(
    (request) => request.kind === "chat",
  );
  const newerRevisionAvailable =
    initialSourceRevision !== "" &&
    agent.sourceRevision !== "" &&
    initialSourceRevision !== agent.sourceRevision;

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
            disabled={compose !== null && !pressed}
            onClick={() =>
              beginTarget(target, container.getBoundingClientRect())
            }
          >
            <Icon icon={MESSAGE_SQUARE_ICON} />
            <span
              role="tooltip"
              className="invisible pointer-events-none absolute top-[calc(100%+0.5rem)] left-0 z-50 w-max max-w-48 rounded-md bg-ink px-2 py-1 text-2xs leading-normal text-bg opacity-0 shadow-raised delay-1000 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 max-sm:right-0 max-sm:left-auto"
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
              disabled={
                compose !== null && targetElement(compose.target) !== block
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
                className="invisible pointer-events-none absolute top-[calc(100%+0.5rem)] right-0 z-50 w-max rounded-md bg-ink px-2 py-1 text-xs text-bg opacity-0 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
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
              disabled={
                compose !== null && targetElement(compose.target) !== block
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
              disabled={compose !== null}
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
      {selectionControl === null || compose !== null ? null : (
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
            </button>,
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
                <div className="rounded-xl bg-surface p-6 text-center text-sm text-muted [&_p]:m-0 [&_p+p]:mt-2">
                  <p>
                    {identity === null
                      ? "Reading offline: drafts stay in this browser until you start the local review runtime."
                      : "No comments staged."}
                  </p>
                  <p>
                    Select text to comment, or use a slide comment icon for the
                    whole slide.
                  </p>
                </div>
              ) : (
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
              )}
              {sent.length > 0 ? (
                <section className="mt-6 border-t border-edge pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="m-0 text-xs font-semibold uppercase tracking-caps text-subtle">
                      Sent threads
                    </p>
                    <Badge tone="secondary" size="compact">
                      {sent.length}
                    </Badge>
                  </div>
                  <p className="mt-1 mb-0 text-xs text-subtle">
                    {sent.length} comment{sent.length === 1 ? "" : "s"} handed
                    off.
                  </p>
                  {sent.map((comment) => (
                    <SentThread
                      key={comment.id}
                      comment={comment}
                      identity={identity}
                      agent={agent}
                      onJump={() => jumpTo(comment)}
                      onAssociate={setAssociatedTarget}
                      onReplySent={setStatus}
                    />
                  ))}
                </section>
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
                  <div>
                    <label
                      className="text-xs font-semibold text-ink"
                      htmlFor="review-agent-chat"
                    >
                      Ask about the whole plan
                    </label>
                    <Textarea
                      id="review-agent-chat"
                      className="mt-1 min-h-24"
                      value={chatBody}
                      maxLength={BODY_LIMIT}
                      placeholder="What should I understand before accepting this plan?"
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
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-2xs text-subtle">
                        {MODIFIER_SHORTCUT}
                      </span>
                      <Button
                        size="compact"
                        disabled={chatBody.trim() === "" || isSendingChat}
                        onClick={() => void sendChat()}
                      >
                        {isSendingChat ? "Sending…" : "Ask agent"}
                      </Button>
                    </div>
                  </div>
                  {chatRequests.length === 0 ? (
                    <p className="m-0 text-xs text-subtle">
                      No plan-wide questions yet.
                    </p>
                  ) : (
                    <ol className="m-0 grid list-none gap-3 p-0">
                      {chatRequests
                        .slice()
                        .reverse()
                        .map((request) => {
                          const response = agent.responses.find(
                            (candidate) =>
                              candidate.requestId === request.requestId &&
                              candidate.kind === "chat",
                          );
                          return (
                            <li key={request.requestId}>
                              <Card className="border border-edge bg-surface p-3 shadow-none">
                                <p className="m-0 text-2xs font-semibold uppercase tracking-caps text-subtle">
                                  You
                                </p>
                                <p className="mt-1 mb-0 text-sm text-ink">
                                  {request.body}
                                </p>
                                <div className="mt-3 border-t border-edge pt-3">
                                  <p className="m-0 text-2xs font-semibold uppercase tracking-caps text-subtle">
                                    Agent
                                  </p>
                                  <p className="mt-1 mb-0 text-sm text-muted">
                                    {response?.message ?? agentStatus.headline}
                                  </p>
                                </div>
                              </Card>
                            </li>
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
              <Card className="border border-edge bg-surface p-3 shadow-none">
                <div className="flex items-start gap-3">
                  <Icon icon={ACTIVITY_ICON} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="m-0 text-sm font-semibold text-ink">
                        {agentStatus.headline}
                      </p>
                      <Badge
                        tone={
                          agentStatus.tone === "positive"
                            ? "accentOutline"
                            : "secondary"
                        }
                        size="compact"
                      >
                        {agentStatus.label}
                      </Badge>
                    </div>
                    <p className="mt-1 mb-0 text-xs text-muted">
                      {agentStatus.detail}
                    </p>
                  </div>
                </div>
              </Card>
              {!agent.presence.connected && runtimeSession !== null ? (
                <Card className="border border-edge bg-well p-3 shadow-none">
                  <p className="m-0 text-xs font-semibold text-ink">
                    Connect a coding agent
                  </p>
                  <code className="mt-2 block min-w-0 overflow-x-auto rounded-md bg-paper p-2 text-2xs text-ink">
                    big-plan agent {runtimeSession.plan}
                  </code>
                  <p className="mt-2 mb-0 text-2xs text-subtle">
                    Paste the returned prompt into Codex or Claude. Your drafts
                    are safe while no agent is connected.
                  </p>
                </Card>
              ) : null}
              <section>
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-xs font-semibold uppercase tracking-caps text-subtle">
                    Agent activity
                  </p>
                  <Badge tone="secondary" size="compact">
                    {agentActivity.length}
                  </Badge>
                </div>
                {agentActivity.length === 0 ? (
                  <p className="mt-2 mb-0 text-xs text-subtle">
                    No coding-agent work has been reported for this request.
                  </p>
                ) : (
                  <ol className="mt-2 grid list-none gap-2 p-0">
                    {agentActivity.map((event) => (
                      <li
                        key={event.seq}
                        className="rounded-md border border-edge bg-surface p-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="m-0 text-xs font-medium text-ink">
                            {event.step}
                          </p>
                          <Badge tone="secondary" size="micro">
                            {event.state}
                          </Badge>
                        </div>
                        {event.detail === undefined ? null : (
                          <p className="mt-1 mb-0 text-2xs text-muted">
                            {event.detail}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <p className="m-0 text-2xs text-subtle">
                Big Plan shows recorded agent signals only. Reviewer actions do
                not count as agent work.
              </p>
            </div>
          ) : null}
          <div className="review-feedback-status flex flex-none flex-col items-stretch gap-2 border-t border-edge bg-paper p-3 text-xs text-subtle">
            {tab === "comments" ? (
              <Button
                className="w-full px-3! py-2! text-xs"
                size="sm"
                disabled={drafts.length === 0 || isSending}
                onClick={() => void sendComments(drafts)}
              >
                {isSending ? "Sending…" : "Send all comments to agent"}
              </Button>
            ) : null}
            {identity === null ? (
              <p className="m-0 text-xs text-support" role="status">
                {status}
              </p>
            ) : (
              <div role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-xs font-semibold text-ink">
                    {agentStatus.headline}
                  </p>
                  <Badge tone="secondary" size="compact">
                    {agentStatus.label}
                  </Badge>
                </div>
                <p className="mt-1 mb-0 text-xs text-support">{status}</p>
              </div>
            )}
          </div>
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
            collapsed={collapsed.has(comment.id)}
            expanded={expandedBodies.has(comment.id)}
            onCollapse={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(comment.id)) next.delete(comment.id);
                else next.add(comment.id);
                return next;
              })
            }
            onExpandBody={() =>
              setExpandedBodies((current) => new Set(current).add(comment.id))
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
        if (host === undefined) return null;
        return createPortal(
          <SentThread
            comment={comment}
            identity={identity}
            agent={agent}
            onJump={() => jumpTo(comment)}
            onAssociate={setAssociatedTarget}
            onReplySent={setStatus}
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
          onCancel={() => setCompose(null)}
          onSave={saveComment}
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
            onCancel={() => setCompose(null)}
            onSave={saveComment}
          />,
          inlineComposeHost,
        )
      )}
      <AlertDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === "all"
            ? "Delete all comments?"
            : "Delete comment?"
        }
        description={
          pendingDelete?.kind === "all"
            ? `This permanently removes all ${pendingDelete.count} staged ${pendingDelete.count === 1 ? "comment" : "comments"}. This action cannot be undone.`
            : "This permanently removes your staged comment. This action cannot be undone."
        }
        actionLabel={pendingDelete?.kind === "all" ? "Delete all" : "Delete"}
        onCancel={() => setPendingDelete(null)}
        onAction={() => {
          if (pendingDelete?.kind === "comment") {
            deleteDraft(pendingDelete.comment.id);
          } else if (pendingDelete?.kind === "all") {
            deleteAllDrafts();
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
