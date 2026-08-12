// Lets an effect that captured plan DOM notice that the plan DOM it captured
// is gone. An in-place refresh replaces the whole article and announces it
// with "bigplan:article-replaced", but a dependency array can only watch
// values, so the announcement is turned into one: a counter that changes every
// time the reading surface is replaced. Naming it in an effect's dependencies
// is what makes that effect re-resolve its elements, listeners, and ranges
// against the article the reader is now reading.

import { useEffect, useState } from "react";

/** Counts in-place replacements of the reading surface, starting at zero. */
export const useArticleVersion = (): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onReplaced = () => setVersion((current) => current + 1);
    document.addEventListener("bigplan:article-replaced", onReplaced);
    return () =>
      document.removeEventListener("bigplan:article-replaced", onReplaced);
  }, []);
  return version;
};
