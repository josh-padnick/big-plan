// Proves the one contract that keeps the Inputs panel in step with the records
// it is derived from: applying a record announces it, and a surface subscribed
// to those announcements reads again.
//
// The failure this covers is silent. The panel joins the answers and
// disposition records, so a reader that applied one without announcing leaves
// the panel showing an older review than the decision card two inches away,
// and nothing throws. Both readers apply through `applyReviewRecord`, so the
// announcement cannot be dropped from one of them without dropping it here.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyReviewRecord,
  onAppliedReviewRecord,
} from "./review-runtime-client.browser.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const listeningPage = (): { readonly announcements: () => number } => {
  vi.stubGlobal("document", new EventTarget());
  let announced = 0;
  onAppliedReviewRecord(() => {
    announced += 1;
  });
  return { announcements: () => announced };
};

describe("applying a review record", () => {
  it("should tell a subscribed surface that a newer record arrived", () => {
    const page = listeningPage();
    const applied = { current: -1 };
    const seen: Array<number> = [];

    for (const revision of [0, 1]) {
      expect(
        applyReviewRecord({
          revision,
          applied,
          apply: () => seen.push(revision),
        }),
      ).toBe(true);
    }

    expect(seen).toEqual([0, 1]);
    expect(applied.current).toBe(1);
    expect(page.announcements()).toBe(2);
  });

  it("should neither apply nor announce a record that lost a race", () => {
    const page = listeningPage();
    const applied = { current: 4 };
    let applications = 0;

    expect(
      applyReviewRecord({
        revision: 3,
        applied,
        apply: () => {
          applications += 1;
        },
      }),
    ).toBe(false);

    expect(applications).toBe(0);
    expect(applied.current).toBe(4);
    expect(page.announcements()).toBe(0);
  });

  it("should stop telling a surface that unsubscribed", () => {
    vi.stubGlobal("document", new EventTarget());
    let announced = 0;
    const stopListening = onAppliedReviewRecord(() => {
      announced += 1;
    });

    applyReviewRecord({
      revision: 0,
      applied: { current: -1 },
      apply: () => undefined,
    });
    stopListening();
    applyReviewRecord({
      revision: 1,
      applied: { current: -1 },
      apply: () => undefined,
    });

    expect(announced).toBe(1);
  });
});
