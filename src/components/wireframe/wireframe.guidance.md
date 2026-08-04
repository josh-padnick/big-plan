# Using Wireframe well

A hand-drawn sketch of a product screen, drawn from a fixed vocabulary so a reviewer argues about the design rather than about the pixels.

- Reach for a wireframe when the reviewer must picture a screen to judge the plan; describe anything they can already picture in prose.
- Deliberately low fidelity is the point. Draw the regions, the copy that carries meaning, and the actions - not the polish.
- Every screen needs `id`, `name`, and `device`. Add a second `Screen` and a `Button` with `navigateTo` to turn a sketch into a walkable prototype, and keep prototypes short: two or three screens along one path.
- All copy is written as attributes: `<Text text="..." />`, `<Metric label="..." value="..." />`, `<Button label="..." />`. A wireframe holds no prose, and the explanation belongs in the paragraphs around it.
- Draw **product UI**, not a design review of the product UI. "Sticky header", "remembered width", and process notes belong outside the artboard. Show keyboard shortcuts only where the real product would visibly teach them.
- Before drawing a desktop screen, name a real SaaS reference pattern (Linear, GitHub, Stripe, Front, Notion). Prefer that pattern over inventing a novel layout.
- Draw as few boxes as you can. A region groups by its heading and the space around it, so `Panel` draws nothing by default: use `surface="filled"` for a workspace pane and `surface="outlined"` only where something behaves like a card. Outlining everything makes every part of the screen shout equally.
- Keep three text levels and no more: the page title, the content, and its metadata. Anything else is a fourth level competing with the title.
- Say state in words first. A `Badge`, or a table cell written `[Failed:danger]`, is a word that a tone only reinforces; a reviewer who cannot see the tint still reads the state.
- Borrow a layout a real product already proved - a table with a toolbar, master-detail, a settings two-column, a focused centered form - rather than inventing one for a solved problem.
- Give every screen one `device`: `desktop`, `tablet`, `tablet-portrait`, or `phone`. It chooses both the true layout width and the matching desktop browser, native iPad, or phone frame, so contradictory combinations are impossible. Add `url` only to `device="desktop"` when the web route matters.
- The artboard lays out at its true device width and scales as one unit to fit the plan; it never reflows into the reading column. Desktop and phone keep realistic minimum silhouettes and may grow. Tablet is different: landscape holds a fixed 1180 × 820 viewport (portrait 820 × 1180), and content that does not fit compacts or scrolls inside the app surface instead of stretching the iPad bezel.
- The frame-level maximize icon is review chrome, not product UI. It opens the current screen fitted and centered in the viewport; use the artboard zoom controls to go below or above that fit while frame and type continue to scale together.
- Every wireframe screen and each meaningful element is already a target in Big Plan's shared commenting model. The inline viewer offers one calm whole-screen comment area. Element comments are deliberate: maximize, choose **Select element**, pick a panel, label, field, or action, then add the comment. Do not draw comment pins, notes, or review controls inside the product UI.
- Use `pattern="list-detail|triage|create|settings"` only when one of those proven layouts fits. `triage` consumes three direct `Panel` slots; the others consume two, and the compiler expands them into ordinary `Row`, `Panel`, and `Rail` nodes at the right widths. Omit `pattern` and use the full vocabulary for dashboards, canvas + inspector, wizards, onboarding, and every other layout.

For how slides, headings, and components sit on the **plan page** (Contrast, Repetition, Alignment, Proximity), follow plan-writing guidance CRAP via `big-plan guidance` section "Lay out slides with CRAP".
Wireframe guidance owns **product UI** form factors inside the artboard, not deck layout.

## Form-factor honesty

A prototype that claims three devices must actually be designed three times.
Do not scale one layout and change the caption.
Each form factor is a **native layout language**, not a stretched or shrunken version of another.

| Form factor      | `device`                      | Shell                                                                                                                          |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Desktop web SaaS | `desktop`                     | Stable `AppShell` + flush-left `Sidebar` + `AppContent`. Workspace density.                                                    |
| Tablet           | `tablet` or `tablet-portrait` | Native iPad frame and navigation bar; intentional master/detail with card-like surfaces. No browser route bar or desktop rail. |
| Phone            | `phone`                       | Single column. `TopBar` + `BottomBar`. No `AppShell` or left rail.                                                             |

When the same product must be reviewed on more than one form factor, author parallel prototypes (separate `Wireframe` blocks or clearly labeled sections), each with its own screens and navigation path.
The compiler rejects a desktop `AppShell` or `Sidebar` on a phone screen and rejects browser `url` chrome on tablet and phone.

## Central product principle

**Use desktop width to keep relevant context visible, not to make containers and controls larger.**

Design each interface around the user's primary job.
Make the next action obvious, preserve context, minimize interruption.

## Establish hierarchy before adding detail

Every screen should quickly communicate what matters, what belongs together, and what the user can do next.
Carry these principles into every wireframe:

1. Create one clear focal point. Use size, position, spacing, or contrast to make the screen's starting place obvious.
2. Design a deliberate reading order from primary information, through supporting context, to the next action. Do not give unrelated regions equal weight and make the user invent a path.
3. Use proximity to communicate relationships. Put related information close together and use space to separate unrelated information before reaching for another border or label.
4. Group content around meaningful user concepts, not merely around the fields available in the data. Each group should communicate one coherent idea.
5. Make the next action obvious. Important sections should answer "What can I do here?", and action labels should describe the outcome.
6. Prefer tangible language that helps the user decide or feel progress. Prefer `$27.50 to go` over `61%`; when appropriate, `You're more than halfway there` is even more human.
7. Match language to the user's mental model. Avoid internal, technical, or adult-oriented terms when the intended user would not naturally say them.
8. Make relationships explicit. Adjacency implies a connection: separate unrelated sections, and directly show when one action affects another area.
9. Reduce competing signals. Borders, buttons, badges, typography, and navigation all consume attention; reserve the strongest treatment for the most important content and action.
10. Use one name for each destination or concept. Describe locked, read-only, complete, or unavailable states in language meaningful to the intended user.
11. Optimize for scanning before reading. A five-second glance at headings, amounts, shapes, and actions should reveal the screen's purpose.
12. Use decoration to reinforce meaning. An icon, illustration, color, or progress treatment should identify content or communicate state rather than fill empty space.
13. Design for the intended feeling: capable, safe, motivated, informed, or in control. Let that emotional goal shape which information leads and how actions are framed.
14. Match fidelity to the decisions being made. Keep early designs rough, grayscale, and easy to change while testing hierarchy and interaction; add polish only after the structure works.

### Quick review before delivery

For every screen, answer these questions from the rendered result:

- What will the user notice first?
- What is the screen primarily helping them understand or accomplish?
- What should they do next?
- Which elements belong together?
- Are any unrelated elements accidentally appearing connected?
- Is anything visually louder than its importance warrants?
- Can any label be made more concrete or human?
- Can the screen be understood in five seconds?
- Does it support the feeling the user should have?
- Is the design polishing structure that is still uncertain?

If any answer is unclear, revise the hierarchy, spacing, grouping, or language before adding more detail.

## Design short task flows, not overloaded destination screens

When a screen asks a person to choose, prepare information, confirm an outcome, or hand work to someone else, draw the sequence instead of compressing every state into one canvas.

1. Give each screen one clear job and one focal point.
2. Make the strongest action name the user's immediate goal; Back, cancel, and change actions stay secondary.
3. Let a choice visibly change the next state or preview. A selected row with an unchanged summary is not a state transition.
4. Reveal information progressively: choose first, ask only for fields the choice needs, then show the complete preview.
5. Use hierarchy, spacing, and a few meaningful surfaces before adding more bordered containers.
6. Lay the sequence along attention: a centered step flow or compact step rail, with the primary action after the active content.
7. Make touch targets unmistakable and at least 44-48 pt; selected state needs a visible word, check, or pressed treatment in addition to tint.
8. Draw a deliberate handoff boundary when control changes person, role, or trust level. Say who holds the device next and place adult approval, authentication, or irreversible work behind that boundary.
9. Use concrete, audience-native language and numbers. Say what exists now, what changes afterward, and what cannot happen yet.
10. Keep sketch looseness on the visual surface only. Reading order, alignment, interaction state, and navigation must remain exceptionally clear.

A useful default sequence is **choose → specify → preview → handoff or finish**. A lesson usually follows **learn → try → see the result → finish**. Keep an error path close to the choice and show that practice did not mutate real state.

Each step does one present-tense job. A preview is for checking the exact words or outcome, with **Edit** and **Looks good** as its two routes; the following handoff screen owns the physical transfer. Keep one term for each concept throughout the flow, and let the stepper draw its own numbers rather than repeating numbers inside labels.

When an actor changes, show a real mode boundary. A child-facing handoff preserves the child's exit and says who should hold the device; the adult-facing gate names the branch-specific request being unlocked. Authentication proves who is present—it never implies consent. Put the full request and any approval action on a separate review state after authentication, and label every button by its immediate result.

Finish learning flows achievement-first: name what the learner figured out, restate the useful answer with a compact visual recap, then quietly distinguish practice from real-world state. The return action should name the purposeful destination, such as **See my wallet**, rather than merely saying Back.

## Responsive product design guidelines

Accepted bar for wireframe product mockups.
Skip any "momentum / enjoyment" framing - clarity and speed are enough.

### Core

1. Design for the form factor (desktop is not scaled mobile; mobile is not shrunken desktop).
2. Use space to expose useful context (master-detail, previews, rails, filters) - not to inflate chrome.
3. Keep the product shell stable across screens.
4. Distinguish navigation from actions (global destinations vs in-page work vs primary buttons).
5. Make direct interaction the default (whole row clickable; clear selected / active / disabled states).

Viewer and surface discipline:

- Persistent tools live in fixed chrome. Reserve a stable top or edge bar for modes, zoom, and other ongoing controls, and let the canvas make room for it; never float persistent controls over the work they affect.
- Chrome frames its content. In an inline or minimized view, draw one containing border around the toolbar and the canvas it controls, with the toolbar as an internal edge; never leave screen chrome hovering as a detached strip above its content.
- A frame that contains only one thing is noise. Keep a containing edge when it groups chrome with the surface it controls; remove a second edge that merely traces the already bounded artboard.
- Independent subsystems talk through a narrow send. A component-local feedback tray owns its screen and element notes end to end, then hands one batch to plan feedback through an explicit integration action; until that integration exists, show an honest stub and retain the notes locally.
- Controls in one row share a centerline. Give adjacent text buttons and icon buttons compatible heights, alignment, and focus geometry so they read as one toolbar.
- A resting figure never claims the page's scroll. Let an ordinary wheel or trackpad gesture continue through the reading document until the reader explicitly clicks into the viewer or maximizes it; only an engaged viewer owns internal canvas or pane scrolling.
- Selection decorates, never deforms. Paint engagement around the viewer with an outline or a border whose transparent width was reserved before selection; never change the artboard's box size, overflow geometry, fitted scale, or internal layout to communicate selection.
- Name the mode, not the halves. Express a binary capability as one explicit switch with a named state—such as **Comment Mode: On/Off**—instead of presenting competing nouns such as **Use / Comment** that ask the user to infer what changed.
- Card interiors share one inset. Align headers, comment rows, and footers to the same horizontal inset, and repeat one compact vertical rhythm so related rows read as a single ordered group rather than independently placed fragments.

### Desktop workspace

6. Treat desktop as a **workspace**: master-detail, panes, independent scroll regions, sticky headers/composers/save bars, remembered selection and pane sizes.
7. Favor **useful density**: tables and decision columns, sticky headers, full-height lists; borders mark hierarchy, not decorative card stacks.
8. Support **keyboard-speed** workflows: search / Cmd+K, list J/K, Enter to open, Cmd+Enter to send or create, multi-select, visible focus and selection.

Desktop shell and density specifics:

- Let the desktop device type scale do its job. Its 28px authored body, 22px supporting copy, 32px section titles, and 42px page titles compensate for the true 1440px workspace being fitted into the review column; at the ordinary fit they paint like roughly 15px body, 12px metadata, 17px section headings, and a 22px page title. Do not shrink controls or labels to create artificial density. Simplify the workspace or let content use more of its realistic canvas.
- Navigation earns readable width. Size a primary desktop rail to its labels plus breathing room—roughly 200-240px at a 1440px workspace—so destinations never wrap, truncate, or crowd the edge. Keep the flush-left rail and its destinations identical on every screen (for example Inbox, Customers, Reports, Settings); at narrower sizes, collapse it deliberately to icons instead of squeezing readable labels into a sliver.
- Keep **global destinations** separate from **contextual views** (Mine, Unassigned, SLA risk) - views live with the inbox content, not mixed into global nav as peers of Settings.
- Master-detail for record work: do **not** replace the queue when opening a ticket. Prefer narrow global nav | list (`span="list"`) | flexible primary (`span="main"`) | properties (`span="rail"`).
- Secondary panes are rails, not equal thirds with the primary surface.
- Settings: Linear-style sub-nav + one dense field column; label/control rows; sticky save; show unsaved / disabled save when idle.
- Create/edit: full-page routes or true modals; main form for input; right rail for intelligence (duplicates, related, routing rationale) - not prototype meta copy inside the UI.

Workspace behavior is part of the layout, not a later implementation detail:

- Hold triage and ticket work to one viewport-height workspace. Global nav, queue, conversation, and inspector scroll independently; keep the record header and composer visible. A horizontal scrollbar is a failed workspace.
- Give flexible width to the primary conversation. Collapse global nav to icons and secondary inspectors to drawers before squeezing the main task.
- Make Reply and Internal note unmistakable modes. Change several cues together—mode label, surface, icon, placeholder, action, and an explicit audience statement such as **Only your team will see this**.
- Give each state one owner. If status is editable in Properties, a header Resolve action must clearly be a synchronized shortcut rather than a second source of truth.
- Design inbox rows for comparison by aligning the same attributes in the same places. A persistent preview earns its width with new judgment context and a recommended next action; otherwise collapse it.
- Keep saved views separate from temporary filter chips. Describe SLA as a decision (**due in 4m**, **breached by 6m**), never as arithmetic the operator must perform.
- In create flows, separate facts, recommendations, and side effects. Duplicate suggestions carry evidence and consequence-naming actions; routing suggestions explain provenance; the final action states what will be created and who will be notified.
- Settings state scope, effect, dependency, and current state before editing. Put dependent controls directly beneath and indented under their parent, label outcomes rather than technologies, show **On/Off** in words, and keep one persistent unsaved-changes bar.

### Mobile

9. Optimize for essential mobile jobs (triage, quick respond, capture, alerts) - bury rare admin behind More / overflow.
10. Design for thumb and interruption (compact top bar, composer near the bottom of the scroll, bottom primary nav, progressive disclosure).
11. Follow mobile navigation conventions (back, dismiss, bottom tabs, list → detail push).
12. Design for interruption and recovery (drafts, preserve list position, retry, undo) - sketch the affordance even at low fidelity.

Phone musts: `device="phone"`, a realistic tall silhouette, single column, `BottomBar` for primary destinations, and no desktop `AppShell` rail. Keep body copy at 16px and metadata at 13px; make ordinary controls at least 44px tall, list rows 52-64px tall, and each bottom tab 60px tall inside an approximately 64px safe-area-aware bar. Let content grow beyond the minimum rather than clipping it; pin persistent chrome so a short state still composes the device deliberately.

### Tablet / iPad

Tablet is its own native layout language, not desktop squeezed into a smaller browser.

- Use the native iPad device frame: no traffic-light dots, URL field, or web-browser route.
- Hold the device viewport itself to 1180 × 820 in landscape (about 1.44:1) or 820 × 1180 in portrait. Compact the composition or let the app content region scroll; never make the bezel taller to accommodate one screen.
- Let the tablet device type scale do its job. Its 26px authored body, 20px supporting copy, 30px section titles, and 44px page titles are deliberately larger than nominal iPadOS points because the true-width artboard is reduced into the review column; at the ordinary fit, body copy paints at roughly 17-19px. Do not shrink individual labels to make more content fit. A children's experience should keep this generous default and use the upper levels decisively.
- Prefer a compact top navigation bar above deliberate master/detail. A master list, lesson outline, or settings section list may remain visible beside the selected detail.
- Spend width on nearby context and touch-friendly card-like surfaces. Use wider gutters and a calmer density than desktop.
- If persistent navigation is necessary, make it an iPad sidebar that participates in master/detail. Do not reuse a full-height desktop global rail merely because `AppShell` can draw one.
- Compose the full canvas. A centered reading measure is appropriate for prose inside a dominant detail pane, not as a tiny island floating alone in a 4:3 artboard.
- Keep related rows and messages compact within each surface. Let unused room follow the group or support another useful pane; never distribute it between a header and its content.

Tablet anti-patterns: browser chrome around a declared iPad, a desktop sidebar plus squeezed workspace panes, a full-width desktop list with inflated spacing, or a lone narrow card surrounded by unused canvas.

### Lists, forms, actions, state

13. Easy-to-scan rows: identity, key context, state, recency; selection and urgency unmistakable (not color alone; explicit counts).
14. Focused forms; progressive disclosure; drafts; desktop label/control alignment.
15. Secondary space for intelligence (duplicates, related, routing, impact) - not empty decorative panels.
16. Model dependencies visibly (this setting enables that control).
17. Clear action hierarchy (one primary; separate destructive).
18. Visible system state (selected, disabled, empty, unsaved, loading) as labels or badges the sketch can show without polish.

### Anti-patterns

- Equal-width columns for global chrome + primary + properties.
- Ticket detail that **drops** the queue (full-page only) when the product is a triage workspace.
- Settings as two large side-by-side cards.
- Floating card sidebar with outer margin on desktop.
- Phone as a vertical iPad (AppShell rail, multi-pane, tablet card stack).
- Tablet as compressed desktop (browser chrome, global rail, desktop density) or a tiny centered island.
- Inflating padding and card chrome to "use" desktop width.

### Authoring checklist

1. Desktop: stable global shell on every screen; master-detail where the job is triage-to-record; `span="list"|"main"|"rail"` proportions; keyboard hints where they matter.
2. Tablet: native iPad frame; compact top navigation; intentional master/detail; no browser chrome or desktop rail.
3. Phone: essential jobs only; bottom nav; list → detail; recovery affordances sketched.
4. No "enjoyable momentum" theater - only clarity, context, and next action.

## Vocabulary

- **Frame** - `AppShell` holds `Sidebar`, an optional `TopBar`, and `AppContent`. On desktop the shell is flush-left and **stable** (same global nav every screen). A native tablet often uses `AppShell` with `TopBar` + `AppContent` and no `Sidebar`; add a card-like sidebar only when it is the master pane. Phone screens skip `AppShell` and use `TopBar` + `BottomBar`.
- **Layout** - `Stack` runs down, `Row` runs across. In a `Row`, `span="fill"` shares width; `span="list"` is a master queue; `span="main"` is the primary surface; `span="rail"` is secondary properties or settings sub-nav.
- **Regions** - `Panel` draws a plain region by default; `Rail` owns a secondary details width; `PageHeader` says what the page is once at the top.
- **Content** - `Metric`, `Progress`, `Table`, `List` / `ListItem` (use `selected` on the active queue row), `Message` for conversation timelines (`kind` customer|agent|internal), `Text` (`role="section"` for grouped phone settings), `Heading`, `Badge`, `Divider`, and `ImagePlaceholder`.
- **Hierarchy** - `Breadcrumbs` and `Crumb` say where a screen sits; `Center` holds reading content to a measure so a form never stretches the whole window.
- **Navigation** - `Nav` / `NavItem` for destinations; `BottomBar` for phone primary destinations. Walkable buttons use `navigateTo` without an external-link arrow glyph.
- **Forms** - `TextField`, `TextArea`, `Select`, `Checkbox`, and `Switch` draw as real controls; every one needs a `label`, and the first three accept `disabled` when a dependency makes them unavailable. `SegmentedControl` groups mutually exclusive view or composer modes; its active button is state, not the screen's filled action.
- **Flow** - `Stepper` / `Step` show multi-step progress; `Connector` draws a labeled transition on a canvas.

```mdx
<Wireframe id="harbor-desktop" title="Harbor, desktop" initialScreen="ticket">
  <Screen
    id="ticket"
    name="Ticket"
    device="desktop"
    url="app.harbor.team/inbox?ticket=4821"
  >
    <AppShell>
      <Sidebar brand="Harbor" mode="Acme Support">
        <Nav label="Global">
          <NavItem label="Inbox" active />
          <NavItem label="Customers" />
          <NavItem label="Reports" />
          <NavItem label="Settings" navigateTo="settings" />
        </Nav>
      </Sidebar>
      <AppContent>
        <PageHeader title="Inbox" description="12 open">
          <Text text="Cmd+K search · J/K move · Enter open" role="helper" />
        </PageHeader>
        <Row gap="sm">
          <Panel title="Queue" span="list">
            <List>
              <ListItem
                label="Checkout freeze"
                meta="Selected · 14m"
                value="#4821"
                selected
              />
              <ListItem label="SSO timeout" meta="Waiting · 2h" value="#4818" />
            </List>
          </Panel>
          <Panel title="Conversation" span="main">
            <List>
              <ListItem
                label="Maya · Customer"
                meta="14m"
                value="Form freezes"
              />
            </List>
            <Text text="Mode: Reply · Internal note" role="helper" />
            <TextArea label="Composer" placeholder="Cmd+Enter to send" />
            <Button label="Send" emphasis="primary" />
          </Panel>
          <Panel title="Properties" span="rail">
            <Select label="Status" value="Open" />
            <Select label="Assignee" value="Alex" />
          </Panel>
        </Row>
      </AppContent>
    </AppShell>
  </Screen>
</Wireframe>
```
