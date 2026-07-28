// Defines the private rule contract and the diagnostics exposed through the
// lintPlan deep-module interface.

import type { Node } from "unist";

export type PlanLintDiagnostic = {
  readonly ruleId: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
};

export type PlanLintFinding = Omit<PlanLintDiagnostic, "ruleId">;

export type PlanLintRule = {
  readonly id: string;
  readonly check: (input: {
    readonly markdown: string;
    readonly tree: Node;
  }) => ReadonlyArray<PlanLintFinding>;
};
