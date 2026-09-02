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
      { label: "Why plans deserve this", slug: "intro/why-big-plan" },
      { label: "Install Big Plan", slug: "intro/installation" },
      { label: "Your first review", slug: "intro/first-review" },
      { label: "A tour of the review document", slug: "intro/tour" },
      { label: "See a rendered plan", slug: "intro/demo" },
      { label: "How Big Plan compares", slug: "intro/vs-other" },
    ],
  },
  {
    label: "Review a plan",
    items: [
      { label: "Overview", slug: "review" },
      { label: "Start a review", slug: "review/start-a-review" },
      { label: "Comment on a plan", slug: "review/comment-on-a-plan" },
      { label: "Answer the plan's decisions", slug: "review/answer-decisions" },
      { label: "Read the agent's changes", slug: "review/read-changes" },
      { label: "Approve a plan", slug: "review/approve-a-plan" },
      { label: "Export a plan as Markdown", slug: "review/export-markdown" },
      { label: "Change how the viewer looks", slug: "review/viewer-settings" },
      { label: "When a review goes wrong", slug: "review/troubleshooting" },
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
    items: [
      { label: "Overview", slug: "for-agents" },
      { label: "Set Big Plan up for your human", slug: "for-agents/setup" },
      {
        label: "Write and validate a plan",
        slug: "for-agents/write-and-validate",
      },
      { label: "Answer reviewer feedback", slug: "for-agents/answer-feedback" },
      { label: "Handle a handoff or disconnect", slug: "for-agents/handoff" },
      { label: "Handle an approval", slug: "for-agents/approval" },
      {
        label: "Install and update the skill",
        slug: "for-agents/use-the-skill",
      },
    ],
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
    label: "Concepts and security",
    items: [
      { label: "Overview", slug: "concepts" },
      { label: "How Big Plan works", slug: "concepts/how-it-works" },
      { label: "One writer owns the plan", slug: "concepts/one-writer" },
      { label: "Trust boundaries", slug: "concepts/trust-boundaries" },
      { label: "Rendered plans are inert", slug: "concepts/inert-documents" },
      { label: "Reporting a vulnerability", slug: "concepts/security-policy" },
      { label: "Supply chain and releases", slug: "concepts/supply-chain" },
    ],
  },
];
