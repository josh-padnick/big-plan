// Owns the presentation-only context that lets a component view know which
// side of its own diff it is rendering without adding review state to models.

import { createContext, useContext, type ReactNode } from "react";
import type { DiffSide } from "../../_model/component-diff/contract.js";

type ComponentDiffPresentation = {
  readonly side: DiffSide;
  readonly status: "added" | "removed" | "changed";
};

const ComponentDiffContext = createContext<ComponentDiffPresentation | null>(
  null,
);

/** Supplies one side's immutable presentation facts to the component view. */
export const ComponentDiffSide = ({
  children,
  side,
  status,
}: ComponentDiffPresentation & { readonly children: ReactNode }) => (
  <ComponentDiffContext value={{ side, status }}>
    {children}
  </ComponentDiffContext>
);

/** Reads diff presentation facts, or null in the ordinary plan rendering. */
export const useComponentDiffPresentation =
  (): ComponentDiffPresentation | null => useContext(ComponentDiffContext);
