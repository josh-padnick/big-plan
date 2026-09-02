// Single source of truth for docs navigation: the Starlight sidebar and the
// agent-facing llms endpoints both derive page order and grouping from here.
//
// Sections are named for what a reader is doing. Only Intro opens expanded,
// because a sidebar that shows every page at once reads as a wall rather than
// as a map; the rest state what they hold and open when asked.

export type SidebarItem = {
  readonly label: string;
  readonly slug: string;
};

export type SidebarGroup = {
  readonly label: string;
  readonly collapsed?: boolean;
  readonly items: readonly SidebarEntry[];
};

/** A sidebar entry is one page or one group of them, nested to any depth. */
export type SidebarEntry = SidebarItem | SidebarGroup;

/** Narrows an entry to the group case for callers walking the tree. */
export const isSidebarGroup = (entry: SidebarEntry): entry is SidebarGroup =>
  "items" in entry;

export const SIDEBAR: readonly SidebarEntry[] = [
  {
    label: "Intro",
    items: [
      { label: "What is Big Plan?", slug: "intro/what-is-big-plan" },
      { label: "Install Big Plan", slug: "intro/installation" },
      { label: "Your first review", slug: "intro/first-review" },
      { label: "UI review", slug: "intro/ui-review" },
      { label: "Sample plans", slug: "samples" },
      { label: "Big Plan vs. other", slug: "intro/vs-other" },
    ],
  },
  {
    label: "Review a plan",
    collapsed: true,
    items: [
      { label: "How it works", slug: "review" },
      { label: "How compilation works", slug: "concepts/how-it-works" },
      { label: "One writer owns the plan", slug: "concepts/one-writer" },
      {
        label: "Components",
        collapsed: true,
        items: [
          { label: "Overview", slug: "components" },
          {
            label: "Decisions",
            collapsed: true,
            items: [
              { label: "Decision", slug: "components/decision" },
              {
                label: "DecisionAnalysis",
                slug: "components/decision-analysis",
              },
              { label: "QuickDecision", slug: "components/quick-decision" },
            ],
          },
          {
            label: "Code and files",
            collapsed: true,
            items: [
              { label: "CodeDiff", slug: "components/code-diff" },
              { label: "CodeSnippet", slug: "components/code-snippet" },
              { label: "FileTree", slug: "components/file-tree" },
              { label: "FileTreeDiff", slug: "components/file-tree-diff" },
            ],
          },
          {
            label: "Data and contracts",
            collapsed: true,
            items: [
              { label: "DataTable", slug: "components/data-table" },
              {
                label: "DatabaseTableSchema",
                slug: "components/database-table-schema",
              },
              { label: "HttpEndpoint", slug: "components/http-endpoint" },
              {
                label: "GraphqlOperation",
                slug: "components/graphql-operation",
              },
              { label: "GrpcMethod", slug: "components/grpc-method" },
            ],
          },
          {
            label: "Pictures",
            collapsed: true,
            items: [
              { label: "FlowDiagram", slug: "components/flow-diagram" },
              { label: "MermaidDiagram", slug: "components/mermaid-diagram" },
              { label: "Wireframe", slug: "components/wireframe" },
            ],
          },
          {
            label: "Document structure",
            collapsed: true,
            items: [
              { label: "Callout", slug: "components/callout" },
              { label: "Part", slug: "components/part" },
              { label: "QuickSummary", slug: "components/quick-summary" },
              { label: "Slide", slug: "components/slide" },
              {
                label: "TableOfContents",
                slug: "components/table-of-contents",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    label: "Write a plan",
    collapsed: true,
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
    label: "Reference",
    collapsed: true,
    items: [
      { label: "Overview", slug: "reference" },
      {
        label: "Commands",
        collapsed: true,
        items: [
          { label: "big-plan guidance", slug: "reference/commands/guidance" },
          { label: "big-plan skill", slug: "reference/commands/skill" },
          { label: "big-plan validate", slug: "reference/commands/validate" },
          { label: "big-plan render", slug: "reference/commands/render" },
          { label: "big-plan compile", slug: "reference/commands/compile" },
          { label: "big-plan review", slug: "reference/commands/review" },
          { label: "big-plan agent", slug: "reference/commands/agent" },
          { label: "big-plan service", slug: "reference/commands/service" },
        ],
      },
      { label: "Error codes", slug: "reference/error-codes" },
      { label: "Lint rules", slug: "reference/lint-rules" },
      { label: "Configuration and state", slug: "reference/configuration" },
      { label: "The compiled plan model", slug: "reference/plan-model" },
      { label: "Files Big Plan writes", slug: "reference/files" },
    ],
  },
  {
    label: "Security",
    collapsed: true,
    items: [
      { label: "Overview", slug: "security" },
      { label: "Rendered plans are inert", slug: "security/inert-documents" },
      { label: "Trust boundaries", slug: "security/trust-boundaries" },
      { label: "Reporting a vulnerability", slug: "security/reporting" },
      { label: "Supply chain and releases", slug: "security/supply-chain" },
    ],
  },
  // One page, so it is a link rather than a group of one.
  { label: "For agents", slug: "for-agents" },
];
