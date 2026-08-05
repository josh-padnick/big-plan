// Owns the closed authorable-component registry and definition lookups shared
// by the Markdown validation and delivery phases.

import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { CALLOUT_COMPONENT_DEFINITION } from "../callout/definition.js";
import { CODE_DIFF_COMPONENT_DEFINITION } from "../code-diff/definition.js";
import { CODE_SNIPPET_COMPONENT_DEFINITION } from "../code-snippet/definition.js";
import { DATA_TABLE_COMPONENT_DEFINITION } from "../data-table/definition.js";
import { DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION } from "../database-table-schema/definition.js";
import { DECISION_COMPONENT_DEFINITION } from "../decision/definition.js";
import { DECISION_ANALYSIS_COMPONENT_DEFINITION } from "../decision-analysis/definition.js";
import { FILE_TREE_DIFF_COMPONENT_DEFINITION } from "../file-tree-diff/definition.js";
import { FILE_TREE_COMPONENT_DEFINITION } from "../file-tree/definition.js";
import { FLOW_DIAGRAM_COMPONENT_DEFINITION } from "../flow-diagram/definition.js";
import { GRAPHQL_OPERATION_COMPONENT_DEFINITION } from "../graphql-operation/definition.js";
import { GRPC_METHOD_COMPONENT_DEFINITION } from "../grpc-method/definition.js";
import { HTTP_ENDPOINT_COMPONENT_DEFINITION } from "../http-endpoint/definition.js";
import { PART_COMPONENT_DEFINITION } from "../part/definition.js";
import { QUICK_SUMMARY_COMPONENT_DEFINITION } from "../quick-summary/definition.js";
import { QUICK_DECISION_COMPONENT_DEFINITION } from "../quick-decision/definition.js";
import { TABLE_OF_CONTENTS_COMPONENT_DEFINITION } from "../table-of-contents/definition.js";
import { WIREFRAME_COMPONENT_DEFINITION } from "../wireframe/definition.js";
import type { ComponentDefinitionRuntime } from "./define-component.js";

export const COMPONENT_REGISTRY = {
  Callout: CALLOUT_COMPONENT_DEFINITION,
  CodeDiff: CODE_DIFF_COMPONENT_DEFINITION,
  CodeSnippet: CODE_SNIPPET_COMPONENT_DEFINITION,
  DataTable: DATA_TABLE_COMPONENT_DEFINITION,
  DatabaseTableSchema: DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION,
  Decision: DECISION_COMPONENT_DEFINITION,
  DecisionAnalysis: DECISION_ANALYSIS_COMPONENT_DEFINITION,
  FileTree: FILE_TREE_COMPONENT_DEFINITION,
  FileTreeDiff: FILE_TREE_DIFF_COMPONENT_DEFINITION,
  FlowDiagram: FLOW_DIAGRAM_COMPONENT_DEFINITION,
  GraphqlOperation: GRAPHQL_OPERATION_COMPONENT_DEFINITION,
  GrpcMethod: GRPC_METHOD_COMPONENT_DEFINITION,
  HttpEndpoint: HTTP_ENDPOINT_COMPONENT_DEFINITION,
  Part: PART_COMPONENT_DEFINITION,
  QuickSummary: QUICK_SUMMARY_COMPONENT_DEFINITION,
  QuickDecision: QUICK_DECISION_COMPONENT_DEFINITION,
  TableOfContents: TABLE_OF_CONTENTS_COMPONENT_DEFINITION,
  Wireframe: WIREFRAME_COMPONENT_DEFINITION,
} as const satisfies Readonly<Record<string, ComponentDefinitionRuntime>>;

export type ComponentRegistry = Readonly<
  Record<string, ComponentDefinitionRuntime>
>;

export type ScopedParentDefinition =
  ComponentDefinitionRuntime | ScopedChildDefinition;

export type RegisteredComponentName = keyof typeof COMPONENT_REGISTRY;

export const REGISTERED_COMPONENT_NAMES: ReadonlySet<string> = new Set(
  Object.keys(COMPONENT_REGISTRY),
);

/** Finds one registered top-level component definition by authored name. */
export const definitionFor = ({
  name,
  registry,
}: {
  readonly name: string | null;
  readonly registry: ComponentRegistry;
}): ComponentDefinitionRuntime | undefined =>
  name !== null && Object.hasOwn(registry, name) ? registry[name] : undefined;

/** Finds one scoped child definition declared by its direct parent. */
export const scopedDefinitionFor = ({
  definitions,
  name,
}: {
  readonly definitions: ScopedParentDefinition["scopedChildren"];
  readonly name: string | null;
}): ScopedChildDefinition | undefined =>
  name !== null && definitions !== undefined && Object.hasOwn(definitions, name)
    ? definitions[name]
    : undefined;
