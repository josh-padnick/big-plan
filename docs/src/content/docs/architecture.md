---
title: How Big Plan works
description: Why Big Plan treats a plan as a compiled document, and how that design produces machine-readable JSON or a self-contained review document.
---

Big Plan's central architectural idea is to treat an authored plan like source code rather than an HTML template.
Before Big Plan chooses an output format, it **compiles** the plan.

Compilation here does not mean generating machine code.
It means reading the authored MDX, rejecting code or component usage outside Big Plan's plan format, and translating each built-in component into plain validated data.

The compiler is not one class or executable inside Big Plan.
It is the coordinated translation path made from the MDX parser, authoring validators, and the compilation function owned by each built-in component.
A component's compilation function knows how to turn that component's attributes and children into validated data; it does not decide whether the final delivery is JSON or HTML.

That shared translation is what keeps validation and both outputs consistent:

- `big-plan compile` collects document metadata and validated component data into machine-readable JSON.
- `big-plan render` presents that same validated component data inside a human-readable HTML review document.
- `big-plan validate` renders the plan in memory while collecting the machine-readable summary, then applies linting rules to the authored plan without writing either output.

The commands run independently, and no command reads output produced by another.
They agree because each starts from the authoritative source file and reuses the same parsing, validation, and component-compilation implementation.

```mermaid
flowchart TB
  A["plan.mdx<br/>authoritative source"]
  A --> F["compileMarkdownTree()<br/>parse, validate, compile components"]
  F --> Q{"Command continuation"}
  Q -- "compilePlanModel()<br/>compileMarkdownModel()" --> G["Collect validated component data"]
  Q -- "renderDocument()<br/>compileMarkdown()" --> H["Render component presentations"]
  Q -- "validateDocument()<br/>compileMarkdownWithModels()" --> M["Render presentations<br/>and collect component data"]
  G --> I["machine-readable JSON"]
  H --> J["self-contained HTML<br/>review document"]
  M --> N["Apply linting rules<br/>no output written"]
```

In the source, `compileMarkdownModel()`, `compileMarkdown()`, and `compileMarkdownWithModels()` are thin entry points over `compileMarkdownTree()`.
That function coordinates the compilation path described above.
It is shared code executed separately by each command, not a cached intermediate artifact or a process that emits output files together.

## Plans are MDX

A plan is an MDX document made from Markdown and built-in components.
Imports, exports, expressions, and inline JSX are rejected.
A plan is prose plus components, nothing else.
That keeps every plan greppable and diffable, which the review workflow depends on, and it means the renderer never has to run code an agent wrote.
The full contract lives in [Authoring plans](/for-agents/authoring-plans/) and [Linting rules](/reference/lint-rules/).

## Slide vocabulary is shared data

Recurring slide roles live in a framework-free catalog below component compilation, lint, and rendering.
Each type owns its stable id and name together with the matching boundary, authoring guidance, component pairings, and cardinality that give the type value.
The [`Slide`](/components/slide/) compiler validates an authored marker against that catalog, the deck transform derives structural names from it, lint reads only its objective facts, and guidance generation returns the same records to agents.
One file per type keeps catalog growth an ordinary reviewed contribution rather than a new architecture decision.

## Each component supports both output modes

The [built-in components](/components/) come from a closed registry.
When `compileMarkdownTree()` reaches a registered component, its definition validates the authored input and returns two things: plain validated data and a React presentation function closed over that data.
The component is compiled once during that command invocation; the selected output mode determines what happens next:

- In **machine-readable output mode**, used by `big-plan compile`, Big Plan collects the validated data in source order and does not invoke the top-level presentation.
- In **HTML output mode**, used by `big-plan render` and `big-plan validate`, Big Plan invokes the presentation, crosses one React-to-HAST boundary, and replaces the authored component node with plain document HAST.
  Validation also collects the component data while rendering, discards the generated document, and applies its registered linting rules to the authored plan.

All three commands therefore agree on component semantics because they call the same compilation function, not because one consumes another command's output.
No plan-authored code is evaluated or shipped.
Ordinary Markdown prose participates only in the human document, while its heading metadata remains available in the machine-readable JSON.

```mermaid
flowchart TB
  S["plan.mdx source"] --> P["Parse allowed Markdown<br/>and component syntax"]
  P --> V["Validate authoring contract"]
  V --> C["Component definition returns<br/>validated data + presentation"]
  C --> Q{"Output mode for this command"}
  Q -- "machine-readable: compile" --> J["Collect document metadata<br/>and validated component data"]
  J --> O["Serialize JSON"]
  Q -- "HTML: render" --> R["Invoke presentation<br/>and cross once to HAST"]
  R --> H["Apply document transforms,<br/>add chrome, serialize HTML"]
  H --> U["Write plan.html"]
  Q -- "HTML + model collection: validate" --> X["Collect validated data,<br/>invoke presentation, cross to HAST"]
  X --> Y["Apply document transforms,<br/>add chrome, serialize HTML"]
  Y --> W["Discard HTML, retain summary,<br/>apply linting rules"]
```

An invalid document never renders partially.
Validation collects every recoverable problem, including unknown components, bad attributes, and malformed fences, and fails with the complete list, each entry carrying a `line:column` position, so an agent can fix those problems in one pass.
An MDX syntax error can stop parsing before component validation begins, so fix that reported error and render again.

## The HTML review document is self-contained

The rendered document embeds everything it needs: styles, branding, favicons, a tiny first-paint preference bootstrap, and the shell's viewer scripts for enhanced affordances.
That script also zooms promoted diagrams and paints a reviewer's comments and proposals over them without touching the plan source.
Plan content never contributes executable code, the document makes no external requests and works offline, and every reading and navigation feature remains usable with scripts disabled.
Nothing about rendering or reviewing a plan touches a server, an account, or anyone else's machine.
