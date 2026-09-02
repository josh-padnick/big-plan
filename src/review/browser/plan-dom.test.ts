// Proves the one distinction a plan-DOM announcement carries: whether plan
// identity moved. A replay that installs a component's own diff view needs the
// shell to run over it and needs every plan-identity listener to leave it
// alone, and only this flag separates the two.

import { describe, expect, it } from "vitest";
import { announcementMovedPlanIdentity } from "./plan-dom.browser.js";

describe("announcementMovedPlanIdentity", () => {
  it("should treat an ordinary replacement as moving plan identity", () => {
    expect(
      announcementMovedPlanIdentity(
        new CustomEvent("bigplan:article-replaced"),
      ),
    ).toBe(true);
    expect(
      announcementMovedPlanIdentity(
        new CustomEvent("bigplan:article-replaced", { detail: {} }),
      ),
    ).toBe(true);
  });

  it("should treat a replay of stripped markup as moving none", () => {
    // The lens host that installed this markup is itself rebuilt by a listener
    // watching article versions, so counting this announcement would tear down
    // the very markup it exists to have wired.
    expect(
      announcementMovedPlanIdentity(
        new CustomEvent("bigplan:article-replaced", {
          detail: { carriesNoPlanIdentity: true },
        }),
      ),
    ).toBe(false);
  });
});
