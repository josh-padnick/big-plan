// Decides when the open change-set tour is showing an earlier round of the set
// it belongs to, so the floating stepper follows the thread it was opened from
// instead of holding the diff that existed when the reviewer opened it.

/**
 * Whether the open tour is behind the change set given here.
 *
 * A thread owns one change set whose result advances as replies commit, so the
 * bounds the stepper holds go stale the moment the next reply publishes. The
 * set is matched by the thread that owns it rather than by its bounds alone:
 * two threads opened against the same plan state share a baseline, so bounds
 * alone would move the reviewer onto another thread's change.
 */
export const tourIsBehind = ({
  activeChangeSetId,
  activeDiff,
  changeSetId,
  diff,
}: {
  readonly activeChangeSetId: string | null;
  readonly activeDiff: { readonly from: string; readonly to: string } | null;
  readonly changeSetId: string | undefined;
  readonly diff: { readonly from: string; readonly to: string } | null;
}): boolean =>
  changeSetId !== undefined &&
  activeChangeSetId === changeSetId &&
  activeDiff !== null &&
  diff !== null &&
  (activeDiff.from !== diff.from || activeDiff.to !== diff.to);
