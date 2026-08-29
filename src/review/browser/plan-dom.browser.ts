// Owns the only browser boundary allowed to replace live plan DOM, the
// announcement every shell script uses to re-resolve detached nodes, and the
// one distinction that announcement carries.

/** What an announcement says about the plan identity behind the new markup. */
export type PlanDomAnnouncement = {
  /**
   * True when the installed markup carries no plan identity at all - a replay
   * of a component's own diff view, stripped of every address before it was
   * installed. Presentation wiring still has to run over it, because a
   * component that sizes itself in the browser has no layout until it does.
   * Nothing that resolves a block, a comment anchor, or an article revision
   * has anything to re-resolve, and a listener that rebuilt its host on this
   * would tear down the very markup the announcement is about.
   */
  readonly carriesNoPlanIdentity?: boolean;
};

export const PLAN_DOM_REPLACED_EVENT = "bigplan:article-replaced";

/** Announces that live plan DOM changed under the shell. */
export const announcePlanDom = (
  announcement: PlanDomAnnouncement = {},
): void => {
  document.dispatchEvent(
    new CustomEvent(PLAN_DOM_REPLACED_EVENT, { detail: announcement }),
  );
};

/** Whether an announcement moved plan identity the reader can point at. */
export const announcementMovedPlanIdentity = (event: Event): boolean =>
  (event as CustomEvent<PlanDomAnnouncement | undefined>).detail
    ?.carriesNoPlanIdentity !== true;

/** Replaces one live plan node and announces that browser wiring must refresh. */
export const replacePlanDom = ({
  target,
  replacement,
}: {
  readonly target: Element;
  readonly replacement: Element;
}): void => {
  target.replaceWith(replacement);
  announcePlanDom();
};
