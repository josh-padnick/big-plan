// Lets an effect that captured plan DOM notice that the plan DOM it captured
// is gone. An in-place refresh replaces the whole article and announces it
// with "bigplan:article-replaced", but a dependency array can only watch
// values, so the announcement is turned into one: a counter that changes every
// time the reading surface is replaced. Naming it in an effect's dependencies
// is what makes that effect re-resolve its elements, listeners, and ranges
// against the article the reader is now reading.
//
// An announcement that moved no plan identity is deliberately not counted. A
// component diff replayed into a lens host is markup with every address
// stripped from it: nothing here can be pointing at it, and an effect that
// rebuilt its host on that announcement would destroy the markup the
// announcement exists to have wired.

import { useEffect, useState } from "react";
import {
  announcementMovedPlanIdentity,
  PLAN_DOM_REPLACED_EVENT,
} from "./plan-dom.browser.js";

/** Counts in-place replacements of the reading surface, starting at zero. */
export const useArticleVersion = (): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onReplaced = (event: Event) => {
      if (!announcementMovedPlanIdentity(event)) return;
      setVersion((current) => current + 1);
    };
    document.addEventListener(PLAN_DOM_REPLACED_EVENT, onReplaced);
    return () =>
      document.removeEventListener(PLAN_DOM_REPLACED_EVENT, onReplaced);
  }, []);
  return version;
};
