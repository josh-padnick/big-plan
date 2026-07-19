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
      { label: "Installation", slug: "intro/installation" },
      { label: "Features", slug: "intro/features" },
      { label: "Why Big Plan?", slug: "intro/why-big-plan" },
      { label: "Big Plan vs. Other", slug: "intro/vs-other" },
      { label: "Roadmap", slug: "intro/roadmap" },
    ],
  },
  {
    label: "Guides",
    items: [
      { label: "Walkthrough", slug: "guides/walkthrough" },
      { label: "Authoring plans", slug: "guides/authoring-plans" },
      { label: "The viewer", slug: "guides/the-viewer" },
    ],
  },
  {
    label: "Components",
    items: [
      { label: "Overview", slug: "components" },
      { label: "Callout", slug: "components/callout" },
      { label: "CodeDiff", slug: "components/code-diff" },
      { label: "CodeSnippet", slug: "components/code-snippet" },
    ],
  },
  {
    label: "Reference",
    items: [{ label: "CLI", slug: "reference/cli" }],
  },
  {
    label: "For Agents",
    items: [{ label: "Render a plan", slug: "for-agents" }],
  },
  {
    label: "Contributing",
    items: [
      { label: "Development", slug: "contributing/development" },
      { label: "Architecture", slug: "contributing/architecture" },
    ],
  },
];
