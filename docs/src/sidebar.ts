// Single source of truth for docs navigation: the Starlight sidebar and the
// agent-facing llms endpoints both derive page order and grouping from here.

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
      { label: "Demo", slug: "intro/demo" },
      { label: "Features", slug: "intro/features" },
      { label: "Installation", slug: "intro/installation" },
      { label: "Big Plan vs. Other", slug: "intro/vs-other" },
    ],
  },
  {
    label: "Architecture",
    items: [{ label: "How Big Plan works", slug: "architecture" }],
  },
  {
    label: "Components",
    items: [
      { label: "Overview", slug: "components" },
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
      { label: "GraphqlOperation", slug: "components/graphql-operation" },
      { label: "GrpcMethod", slug: "components/grpc-method" },
      { label: "HttpEndpoint", slug: "components/http-endpoint" },
      { label: "Part", slug: "components/part" },
      { label: "QuickSummary", slug: "components/quick-summary" },
      { label: "QuickDecision", slug: "components/quick-decision" },
      { label: "TableOfContents", slug: "components/table-of-contents" },
      { label: "Wireframe", slug: "components/wireframe" },
    ],
  },
  {
    label: "Reference",
    items: [
      { label: "CLI", slug: "reference/cli" },
      { label: "Linting rules", slug: "reference/lint-rules" },
    ],
  },
  {
    label: "For Agents",
    items: [
      { label: "Overview", slug: "for-agents" },
      { label: "Use the skill", slug: "for-agents/use-the-skill" },
      { label: "Render a plan", slug: "for-agents/render-a-plan" },
      { label: "Authoring plans", slug: "for-agents/authoring-plans" },
    ],
  },
];
