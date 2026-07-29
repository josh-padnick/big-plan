// Owns the closed authorable-component registry and definition lookups shared
// by the Markdown validation and delivery phases.

import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { BIG_DECISION_COMPONENT_DEFINITION } from "../big-decision/definition.js";
import { CALLOUT_COMPONENT_DEFINITION } from "../callout/definition.js";
import { CODE_DIFF_COMPONENT_DEFINITION } from "../code-diff/definition.js";
import { CODE_SNIPPET_COMPONENT_DEFINITION } from "../code-snippet/definition.js";
import { DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION } from "../database-table-schema/definition.js";
import { FILE_TREE_DIFF_COMPONENT_DEFINITION } from "../file-tree/file-tree-diff-definition.js";
import { FILE_TREE_COMPONENT_DEFINITION } from "../file-tree/file-tree-definition.js";
import { GRAPHQL_OPERATION_COMPONENT_DEFINITION } from "../graphql-operation/definition.js";
import { GRPC_METHOD_COMPONENT_DEFINITION } from "../grpc-method/definition.js";
import { HTTP_ENDPOINT_COMPONENT_DEFINITION } from "../http-endpoint/definition.js";
import { QUICK_SUMMARY_COMPONENT_DEFINITION } from "../quick-summary/definition.js";
import { SMALL_DECISION_SET_COMPONENT_DEFINITION } from "../small-decision-set/definition.js";
import type { ComponentDefinition } from "./define-component.js";

export const COMPONENT_REGISTRY: Readonly<Record<string, ComponentDefinition>> =
  {
    BigDecision: BIG_DECISION_COMPONENT_DEFINITION,
    Callout: CALLOUT_COMPONENT_DEFINITION,
    CodeDiff: CODE_DIFF_COMPONENT_DEFINITION,
    CodeSnippet: CODE_SNIPPET_COMPONENT_DEFINITION,
    DatabaseTableSchema: DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION,
    FileTree: FILE_TREE_COMPONENT_DEFINITION,
    FileTreeDiff: FILE_TREE_DIFF_COMPONENT_DEFINITION,
    GraphqlOperation: GRAPHQL_OPERATION_COMPONENT_DEFINITION,
    GrpcMethod: GRPC_METHOD_COMPONENT_DEFINITION,
    HttpEndpoint: HTTP_ENDPOINT_COMPONENT_DEFINITION,
    QuickSummary: QUICK_SUMMARY_COMPONENT_DEFINITION,
    SmallDecisionSet: SMALL_DECISION_SET_COMPONENT_DEFINITION,
  };

export type ComponentRegistry = Readonly<Record<string, ComponentDefinition>>;

export type ScopedParentDefinition =
  ComponentDefinition | ScopedChildDefinition;

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
}): ComponentDefinition | undefined =>
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
