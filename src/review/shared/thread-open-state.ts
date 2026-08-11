// Owns comment-thread disclosure across the feedback rail and inline layer.
// The UI stores only deviations from the product defaults.

export type ThreadKind = "draft" | "sent";
export type ThreadSurface = "inline" | "rail";
export type ThreadOpenChannel = "primary" | "overlay";
export type ThreadOpenState = ReadonlyMap<
  string,
  Readonly<Partial<Record<ThreadOpenChannel, boolean>>>
>;

const channelFor = ({
  surface,
  isRailOpen,
}: {
  readonly surface: ThreadSurface;
  readonly isRailOpen: boolean;
}): ThreadOpenChannel =>
  surface === "inline" && isRailOpen ? "overlay" : "primary";

/** Resolves one thread's open state from its surface and product defaults. */
export const isThreadOpen = ({
  state,
  commentId,
  kind,
  surface,
  isRailOpen,
}: {
  readonly state: ThreadOpenState;
  readonly commentId: string;
  readonly kind: ThreadKind;
  readonly surface: ThreadSurface;
  readonly isRailOpen: boolean;
}): boolean => {
  if (kind === "draft" && surface === "rail") return true;
  const channel = channelFor({ surface, isRailOpen });
  const stored = state.get(commentId)?.[channel];
  if (stored !== undefined) return stored;
  return channel === "primary" && kind === "draft";
};

/** Sets one disclosure channel without leaking surface rules to callers. */
export const setThreadOpen = ({
  state,
  commentId,
  kind,
  surface,
  isRailOpen,
  open,
}: {
  readonly state: ThreadOpenState;
  readonly commentId: string;
  readonly kind: ThreadKind;
  readonly surface: ThreadSurface;
  readonly isRailOpen: boolean;
  readonly open: boolean;
}): ThreadOpenState => {
  if (kind === "draft" && surface === "rail") return state;
  const channel = channelFor({ surface, isRailOpen });
  const next = new Map(state);
  next.set(commentId, { ...next.get(commentId), [channel]: open });
  return next;
};

/** Toggles one thread through the same rule used to render it. */
export const toggleThreadOpen = (
  input: Omit<Parameters<typeof setThreadOpen>[0], "open">,
): ThreadOpenState =>
  setThreadOpen({
    ...input,
    open: !isThreadOpen(input),
  });

/** Drops transient inline-over-rail disclosure when the rail closes. */
export const clearThreadOpenOverlay = (
  state: ThreadOpenState,
): ThreadOpenState =>
  new Map(
    [...state].flatMap(([commentId, value]) => {
      const { overlay: _overlay, ...primary } = value;
      return Object.keys(primary).length === 0
        ? []
        : [[commentId, primary] as const];
    }),
  );
