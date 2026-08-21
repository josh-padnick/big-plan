// Owns the only browser boundary allowed to replace live plan DOM and the
// announcement every shell script uses to re-resolve detached nodes.

/** Replaces one live plan node and announces that browser wiring must refresh. */
export const replacePlanDom = ({
  target,
  replacement,
}: {
  readonly target: Element;
  readonly replacement: Element;
}): void => {
  target.replaceWith(replacement);
  document.dispatchEvent(new CustomEvent("bigplan:article-replaced"));
};
