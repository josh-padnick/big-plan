// Owns one fact the whole review island has to agree on: whether the plan DOM
// on screen is the plan the runtime holds.
//
// It exists because "this block is not in the article" is two different
// answers wearing one face. It can mean the change is gone from the plan, in
// which case there is nothing to draw. It can also mean the article on screen
// is a revision behind, in which case the change is exactly where it always
// was and the right answer is to wait. Both look identical to a resolver that
// only asks the DOM.
//
// The fact is the two snapshot ids the page already holds for every writer:
// the one the article was rendered from, and the one the runtime says is
// current. That is what makes it complete. An earlier version asked which
// writer had moved the bytes and started a timer, so it knew about the
// reviewer's verdicts and not about the agent's publishes - and a page behind
// an agent revision drew four rounds of defects because no one had started its
// clock. Two ids cannot be wrong about who wrote them, and cannot expire.

/** Whether the article on screen is a revision behind the runtime's plan. */
export const isPlanDomBehind = ({
  displayedSnapshot,
  currentSnapshot,
}: {
  /** The snapshot the article on screen was rendered from. */
  readonly displayedSnapshot: string;
  /** The snapshot the runtime says the plan is at now. */
  readonly currentSnapshot: string;
}): boolean =>
  // An unknown snapshot on either side is not evidence of a lag: before the
  // first poll answers there is nothing to compare, and treating that as
  // behind would hide every change on a page that has only just opened.
  displayedSnapshot !== "" &&
  currentSnapshot !== "" &&
  displayedSnapshot !== currentSnapshot;
