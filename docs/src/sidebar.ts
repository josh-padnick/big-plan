// Single source of truth for docs navigation: the Starlight sidebar and the
// agent-facing llms endpoints both derive page order and grouping from here.
//
// Sections are named for what a reader is doing, and each one after Intro opens
// with an overview whose last block is a guide naming which page to read when.

export type SidebarItem = {
  readonly label: string;
  readonly slug: string;
};

export type SidebarGroup = {
  readonly label: string;
  readonly items: readonly SidebarItem[];
};

export const SIDEBAR: readonly SidebarGroup[] = [
  {
    label: "Intro",
    items: [
      { label: "What is Big Plan?", slug: "intro/what-is-big-plan" },
      { label: "Install Big Plan", slug: "intro/installation" },
      { label: "Your first review", slug: "intro/first-review" },
      { label: "UI review", slug: "intro/ui-review" },
      { label: "Big Plan vs. other", slug: "intro/vs-other" },
    ],
  },
  {
    label: "Sample plans",
    items: [
      { label: "Overview", slug: "samples" },
      {
        label: "Rate limiting for a public API",
        slug: "samples/rate-limiting",
      },
      { label: "A payments retry queue", slug: "samples/retry-queue" },
      { label: "A workflow builder surface", slug: "samples/workflow-builder" },
      { label: "Every component at once", slug: "samples/all-components" },
    ],
  },
  {
    label: "Review a plan",
    items: [
      { label: "How it works", slug: "review" },
      { label: "Components", slug: "components" },
      { label: "Callout", slug: "components/callout" },
      { label: "CodeDiff", slug: "components/code-diff" },
      { label: "CodeSnippet", slug: "components/code-snippet" },
      { label: "DataTable", slug: "components/data-table" },
      {
        label: "DatabaseTableSchema",
        slug: "components/database-table-schema",
      },
      { label: "Decision", slug: "components/decision" },
      { label: "DecisionAnalysis", slug: "components/decision-analysis" },
      { label: "FileTree", slug: "components/file-tree" },
      { label: "FileTreeDiff", slug: "components/file-tree-diff" },
      { label: "FlowDiagram", slug: "components/flow-diagram" },
      { label: "MermaidDiagram", slug: "components/mermaid-diagram" },
      { label: "GraphqlOperation", slug: "components/graphql-operation" },
      { label: "GrpcMethod", slug: "components/grpc-method" },
      { label: "HttpEndpoint", slug: "components/http-endpoint" },
      { label: "Part", slug: "components/part" },
      { label: "QuickSummary", slug: "components/quick-summary" },
      { label: "QuickDecision", slug: "components/quick-decision" },
      { label: "Slide", slug: "components/slide" },
      { label: "TableOfContents", slug: "components/table-of-contents" },
      { label: "Wireframe", slug: "components/wireframe" },
    ],
  },
  {
    label: "Write a plan",
    items: [
      { label: "Overview", slug: "authoring" },
      { label: "Anatomy of a plan", slug: "authoring/anatomy-of-a-plan" },
      { label: "Where each rule lives", slug: "authoring/where-rules-live" },
      {
        label: "Choose the right component",
        slug: "authoring/choose-a-component",
      },
      { label: "Slide types", slug: "authoring/slide-types" },
      {
        label: "Fix a validation error",
        slug: "authoring/fix-a-validation-error",
      },
    ],
  },
  {
    label: "For agents",
    items: [{ label: "For agents", slug: "for-agents" }],
  },
  {
    label: "Reference",
    items: [
      { label: "Overview", slug: "reference" },
      { label: "big-plan guidance", slug: "reference/commands/guidance" },
      { label: "big-plan skill", slug: "reference/commands/skill" },
      { label: "big-plan validate", slug: "reference/commands/validate" },
      { label: "big-plan render", slug: "reference/commands/render" },
      { label: "big-plan compile", slug: "reference/commands/compile" },
      { label: "big-plan review", slug: "reference/commands/review" },
      { label: "big-plan agent", slug: "reference/commands/agent" },
      { label: "big-plan service", slug: "reference/commands/service" },
      { label: "Error codes", slug: "reference/error-codes" },
      { label: "Lint rules", slug: "reference/lint-rules" },
      { label: "Configuration and state", slug: "reference/configuration" },
      { label: "The compiled plan model", slug: "reference/plan-model" },
      { label: "Files Big Plan writes", slug: "reference/files" },
    ],
  },
  {
    label: "Concepts",
    items: [
      { label: "How compilation works", slug: "concepts/how-it-works" },
      { label: "One writer owns the plan", slug: "concepts/one-writer" },
    ],
  },
  {
    label: "Security",
    items: [
      { label: "Overview", slug: "security" },
      { label: "Rendered plans are inert", slug: "security/inert-documents" },
      { label: "Trust boundaries", slug: "security/trust-boundaries" },
      { label: "Reporting a vulnerability", slug: "security/reporting" },
      { label: "Supply chain and releases", slug: "security/supply-chain" },
    ],
  },
];
