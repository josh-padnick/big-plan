// The v1 fixture corpus is intentionally varied: semantic tests protect the
// authoring subset while the browser render test protects Mermaid integration.

export const MERMAID_FIXTURES = [
  {
    name: "top-bottom",
    source:
      "flowchart TB\n  intake[Receive] --> review{Review}\n  review --> approved[Approved]",
  },
  {
    name: "top-down",
    source:
      "graph TD\n  source[Source] --> build[Build]\n  build --> ship[Ship]",
  },
  {
    name: "bottom-top",
    source:
      "flowchart BT\n  result((Result)) --> source[Source]\n  source -.-> note[Note]",
  },
  {
    name: "right-left",
    source:
      "graph RL\n  done[[Done]] --> work[Work]\n  work --> start([Start])",
  },
  {
    name: "all-shapes",
    source:
      "flowchart LR\n  rect[Rectangle] --> round(Round)\n  round --> circle((Circle))\n  circle --> diamond{Decision}\n  diamond --> hex{{Hexagon}}\n  hex --> stadium([Stadium])\n  stadium --> cylinder[(Cylinder)]\n  cylinder --> sub[[Subroutine]]\n  sub --> para[/Parallelogram/]\n  para --> asym>Asymmetric]",
  },
  {
    name: "edge-behavior",
    source:
      "flowchart LR\n  a[Fan out] -->|solid| b[One]\n  a -.->|dotted| c[Two]\n  a ==> d[Thick]\n  a --o e[Open]\n  a --x f[Cross]",
  },
  {
    name: "cycles-and-parallel",
    source:
      "flowchart LR\n  a[Alpha] -->|first| b[Beta]\n  a -.->|second| b\n  a ==> b\n  b --> c[Gamma]\n  c --> a",
  },
  {
    name: "rank-skipping-and-unicode",
    source:
      "graph LR\n  start[开始 · Start] --> middle[Long label: validation, review, and delivery]\n  middle --> finish[✅ Done]\n  start --> finish",
  },
  {
    name: "trapezoids-and-leans",
    source:
      "flowchart LR\n  lean[/Lean right/] --> trap[/Trapezoid\\]\n  trap --> alt[\\Lean left\\]\n  alt --> alttrap[\\Trapezoid alt/]",
  },
  {
    name: "bidirectional-and-plain-links",
    source:
      "flowchart LR\n  a[Alpha] <--> b[Beta]\n  a <==> c[Gamma]\n  a <-.-> d[Delta]\n  b --- c\n  c === d",
  },
  {
    name: "spaceless-links",
    source:
      "flowchart LR\n  a[Alpha]-->b[Beta]\n  b-.->c[Gamma]\n  c===d[Delta]\n  a---d",
  },
  {
    name: "labeled-text-edges",
    source:
      "flowchart LR\n  a[Alpha] -- ships --> b[Beta]\n  b -- keeps --- c[Gamma]\n  c -- circles --o d[Delta]\n  d -- crosses --x e[Epsilon]\n  a == fast ==> e\n  b -. slow .-> d",
  },
  {
    name: "sequence-static",
    source:
      "sequenceDiagram\n  Alice->>Bob: Review the plan\n  Bob-->>Alice: Approved",
  },
  {
    name: "class-static",
    source:
      "classDiagram\n  class Plan {\n    +String title\n    +compile()\n  }\n  class Renderer\n  Plan --> Renderer",
  },
  {
    name: "state-static",
    source:
      "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Accepted\n  Accepted --> [*]",
  },
  {
    name: "er-static",
    source:
      "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains",
  },
  {
    name: "gantt-static",
    source:
      "gantt\n  title Delivery\n  dateFormat YYYY-MM-DD\n  section Build\n  Compile :done, compile, 2026-01-01, 2d\n  Review :review, after compile, 2d",
  },
  {
    name: "pie-static",
    source:
      'pie title Review effort\n  "Authoring" : 40\n  "Validation" : 35\n  "Review" : 25',
  },
  {
    name: "journey-static",
    source:
      "journey\n  title Plan review\n  section Understand\n    Read the diagram: 5: Reviewer\n    Leave feedback: 4: Reviewer",
  },
  {
    name: "mindmap-static",
    source:
      "mindmap\n  root((Plan review))\n    Source\n      MDX\n    Output\n      Static SVG",
  },
  {
    name: "timeline-static",
    source:
      "timeline\n  title Release history\n  2026 : Mermaid shipped\n       : Gallery expanded",
  },
  {
    name: "gitgraph-static",
    source:
      'gitGraph\n  commit id: "base"\n  branch review\n  checkout review\n  commit id: "gallery"',
  },
] as const;
