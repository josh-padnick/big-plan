// Bridges compiled plan models to React: converts the HAST subtrees the
// model layer carries (prose bodies, icon elements) into React nodes without
// reimplementing prose conversion.

import type { ElementContent, Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

/** Renders model-carried HAST content (prose bodies, icons) as React nodes. */
export const hastContentToReact = (
  content: ReadonlyArray<ElementContent>,
): ReactNode => {
  const root: Root = { type: "root", children: [...content] };
  return toJsxRuntime(root, { Fragment, jsx, jsxs });
};
