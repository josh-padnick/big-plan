// Proves a multi-image batch keeps its own order and preserves reviewer edits
// while uploads complete.

import { describe, expect, it } from "vitest";
import {
  insertAtComposerAnchor,
  rebaseComposerInsertion,
} from "./compose-image-anchor.js";

describe("composer image insertion anchor", () => {
  it("should move later references past typing inserted before the captured caret", () => {
    const first = insertAtComposerAnchor({
      anchor: { body: "alpha omega", offset: 6 },
      reference: "[one]",
    });
    const edited = rebaseComposerInsertion({
      anchor: first,
      body: "typed alpha [one]omega",
    });

    expect(
      insertAtComposerAnchor({ anchor: edited, reference: "[two]" }),
    ).toEqual({
      body: "typed alpha [one][two]omega",
      offset: 22,
    });
  });

  it("should preserve live typing when an earlier batch reference is deleted", () => {
    const first = insertAtComposerAnchor({
      anchor: { body: "alpha omega", offset: 6 },
      reference: "[one]",
    });
    const withoutFirst = rebaseComposerInsertion({
      anchor: first,
      body: "alpha omega",
    });
    const edited = rebaseComposerInsertion({
      anchor: withoutFirst,
      body: "alpha omega live",
    });

    expect(
      insertAtComposerAnchor({ anchor: edited, reference: "[two]" }).body,
    ).toBe("alpha [two]omega live");
  });
});
