# Using Wireframe well

A hand-drawn sketch of a product screen, drawn from a fixed vocabulary so a reviewer argues about the design rather than about the pixels.

- Reach for a wireframe when the reviewer must picture a screen to judge the plan; describe anything they can already picture in prose.
- Deliberately low fidelity is the point. Draw the regions, the copy that carries meaning, and the actions - not the polish.
- Every screen needs `id` and `name`. Add a second `Screen` and a `Button` with `navigateTo` to turn a sketch into a walkable prototype, and keep prototypes short: two or three screens along one path.
- All copy is written as attributes: `<Text text="..." />`, `<Metric label="..." value="..." />`, `<Button label="..." />`. A wireframe holds no prose, and the explanation belongs in the paragraphs around it.
- Draw **product UI**, not a design review of the product UI. Keyboard cheatsheets, "sticky header", "remembered width", and process notes belong outside the artboard - never as on-screen helper copy a customer would not see.
- Before drawing a desktop screen, name a real SaaS reference pattern (Linear, GitHub, Stripe, Front, Notion). Prefer that pattern over inventing a novel layout.
- Pick the `viewport` the design is really for. The artboard reflows to the reader's width instead of shrinking the text, so the preset sets the shape rather than the final size.
- Say what kind of product this is with `chrome`. A web product uses `chrome="browser"` and a `url`, which tells a reviewer the route before they read a label; a phone screen uses `chrome="phone"`. An unframed screen floats on the page and reads as a tablet app whatever is inside it, so frame every screen of a real product and keep the frame the same across the prototype.

For how slides, headings, and components sit on the **plan page** (Contrast, Repetition, Alignment, Proximity), follow plan-writing guidance CRAP via `big-plan guidance` section "Lay out slides with CRAP".
Wireframe guidance owns **product UI** form factors inside the artboard, not deck layout.

## Form-factor honesty

A prototype that claims three devices must actually be designed three times.
Do not scale one layout and change the caption.
Each form factor is a **native layout language**, not a stretched or shrunken version of another.

| Form factor      | `viewport`                              | `chrome`                       | Shell                                                                       |
| ---------------- | --------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| Desktop web SaaS | `desktop`                               | `browser` + `url`              | Stable `AppShell` + flush-left `Sidebar` + `AppContent`. Workspace density. |
| Tablet           | `tablet-landscape` or `tablet-portrait` | `browser` when it is a web app | Master/detail, wider gutters, card surfaces OK.                             |
| Phone            | `mobile-portrait`                       | `phone`                        | Single column. `TopBar` + `BottomBar`. No left rail.                        |

When the same product must be reviewed on more than one form factor, author parallel prototypes (separate `Wireframe` blocks or clearly labeled sections), each with its own screens and navigation path.
Do not mix phone chrome with a desktop sidebar on one screen.

## Reference patterns by screen archetype

Name the reference pattern in plan prose before drawing.
Keep the rationale outside the artboard; the artboard contains only product UI.

| Archetype                       | Desktop web SaaS                                                                                                     | Tablet                                                                                  | Phone                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Inbox, queue, or search results | Front / Intercom **list + inspector**: saved views and filters above stable scanning columns; selected row + preview | iPadOS **master/detail**: touch-friendly list and persistent preview                    | iOS **list → detail push**: full-width, whole-row targets; no separate Open action                       |
| Record or conversation detail   | Front / Zendesk **three-pane workspace**: compact queue \| dominant conversation \| properties rail                  | iPadOS **split view**: master and detail, with secondary properties disclosed as needed | iOS **push detail**: back affordance, vertical timeline, overflow for secondary actions                  |
| Create or edit                  | Linear / GitHub **full-page form + intelligence rail**: primary form with duplicate/routing context beside it        | Focused form or true sheet sized to the task                                            | Single-column keyboard-first form with a sticky action above keyboard and safe area                      |
| Settings or administration      | Linear / Stripe **settings nav + dense form column**: named sections, visible dependencies, one save model           | Navigation + detail, or grouped settings when scope is small                            | iOS **grouped overview → detail**: rows open dedicated screens; do not mix navigation rows with switches |

If the screen does not match one of these archetypes, name another proven product pattern and explain why it fits.
Do not invent a novel shell for a solved workflow.

## Encoding ownership

Use the strongest rung that can carry a rule: **primitive default > compile diagnostic > plan lint > guidance/example**.
Guidance names capabilities and judgment; it must not become the only owner of geometry or a structurally decidable rule.

| Rule family                                                                                                                                                                      | Highest valid rung           | Current owner                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Desktop review width; semantic `list \| main \| rail` proportions; non-wrapping panes; two-line truncating rows; selection-edge inset                                            | Primitive default            | Renderer/view/CSS                                                                                                                   |
| Phone 16px body + 13px metadata; bounded 44px tertiary actions; 56px tabs; full-width field + trailing action; grouped-settings hierarchy and destructive zone                   | Primitive default            | View/CSS; authors opt into the semantic `section` text role and group the destructive action with its warning                       |
| Plain regions with outlined boxes reserved for card-like surfaces                                                                                                                | Primitive default candidate  | **Not encoded yet**: `Panel` still draws a box, so the border budget below is guidance until the primitive owns a plain default     |
| Semantic desktop panes required for 3+ column workspaces; phone viewport/chrome/shell coherence; one primary action per screen; visible detail paired with a selected master row | Compile diagnostic candidate | **Not encoded yet**: treat the related rules below as requirements that belong in compilation, not as permanently prose-only advice |
| Reference archetype, useful context, content priority, progressive disclosure, interruption/recovery behavior                                                                    | Guidance + pattern examples  | Author judgment; copy a proven skeleton, then adapt its product content                                                             |

When a rendered review exposes a geometry or structural defect, push the fix to the rung named here and shorten the prose after the product carries it.

## Central product principle

**Use desktop width to keep relevant context visible, not to make containers and controls larger.**

Design each interface around the user's primary job.
Make the next action obvious, preserve context, minimize interruption.

## Density, hierarchy, and geometry

Use the form factor's native density rather than stretching one composition.

| Rule             | Desktop                                                                                | Tablet                                                           | Phone                                                  |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Density          | Tight 8px rhythm; 20-24px pane padding; multiple useful regions visible                | More breathing room and card-like surfaces are acceptable        | 16px page margins; fewer controls and fields at once   |
| Type hierarchy   | 22-24px page title; 14-16px primary content; 12-13px muted metadata                    | Preserve clear title/content/metadata levels with looser spacing | 20-24px title; 16px body; 13px metadata                |
| Interaction size | Dense controls may be compact, but targets remain clear                                | Touch-sized controls                                             | 44px minimum controls; 52-64px list rows and 56px tabs |
| Content measure  | Keep prose and forms near 60-80 characters; do not full-bleed fields across the canvas | Let master/detail surfaces use the device width                  | Single column; progressive disclosure                  |

Primitive default: desktop workspace rows carrying `span="list"`, `span="main"`, or `span="rail"` become one non-wrapping pane system.
They must remain side by side: the list and rail may shrink to their safe minimums, while `main` claims the rest.
Never let a properties rail silently drop below the primary pane.
In the real product, collapse secondary panes into drawers at a narrower application breakpoint rather than squeezing them into unreadable columns.

Primitive-default candidate: use one divider between major desktop panes, subtle surface changes for hierarchy, and outlined boxes mainly for inputs or genuinely interactive controls.
Do not outline every content group.

Every scanning `ListItem` follows one resilient row model:

- Line 1: a single-line truncating identity on the left and an optional fixed trailing value (age, amount, id) on the right.
- Line 2: muted, single-line truncating metadata.
- Never allow a long label to wrap one word per line or overlap its metadata/value; the label and metadata yield with ellipsis, while the trailing value does not shrink.
- A selected row's accent edge owns its own inset; never paint the edge beneath the first glyph.
- Primitive default: on phone, `navigateTo` makes the whole 52-64px row the action; do not add an Open button inside or beside it.
- Compile-diagnostic candidate: a desktop detail view must pair with a `selected` master row; the primitive supplies its tint, edge, and safe text inset.

## Responsive product design guidelines

Accepted bar for wireframe product mockups.
Skip any "momentum / enjoyment" framing - clarity and speed are enough.

### Core

1. Design for the form factor (desktop is not scaled mobile; mobile is not shrunken desktop).
2. Use space to expose useful context (master-detail, previews, rails, filters) - not to inflate chrome.
3. Keep the product shell stable across screens.
4. Distinguish navigation from actions (global destinations vs in-page work vs primary buttons).
5. Make direct interaction the default (whole row clickable; clear selected / active / disabled states).

### Desktop workspace

6. Treat desktop as a **workspace**: master-detail, panes, independent scroll regions, sticky headers/composers/save bars, remembered selection and pane sizes.
7. Favor **useful density**: tables and decision columns, sticky headers, full-height lists; borders mark hierarchy, not decorative card stacks.
8. Support **keyboard-speed** workflows: search, list movement, open, send/create, multi-select, visible focus and selection. Show shortcut labels only in conventional discoverability surfaces; never add a persistent keyboard cheatsheet to the artboard.

Desktop shell and density specifics:

- Flush-left global nav rail, identical destinations on every screen (for example Inbox, Customers, Reports, Settings).
- Keep **global destinations** separate from **contextual views** (Mine, Unassigned, SLA risk) - views live with the inbox content, not mixed into global nav as peers of Settings.
- Master-detail for record work: do **not** replace the queue when opening a ticket. Prefer narrow global nav | list (`span="list"`) | flexible primary (`span="main"`) | properties (`span="rail"`).
- Secondary panes are rails, not equal thirds with the primary surface.
- Settings: Linear-style sub-nav + one dense field column; label/control rows; sticky save; show unsaved / disabled save when idle.
- Create/edit: full-page routes or true modals; main form for input; right rail for intelligence (duplicates, related, routing rationale) - not prototype meta copy inside the UI.

### Mobile

9. Optimize for essential mobile jobs (triage, quick respond, capture, alerts) - bury rare admin behind More / overflow.
10. Design for thumb and interruption (compact top bar, composer near the bottom of the scroll, bottom primary nav, progressive disclosure).
11. Follow mobile navigation conventions (back, dismiss, bottom tabs, list → detail push).
12. Design for interruption and recovery (drafts, preserve list position, retry, undo) - sketch the affordance even at low fidelity.

Compile-diagnostic candidate: a phone composition uses `viewport="mobile-portrait"`, `chrome="phone"`, a single column, and `BottomBar` for primary destinations - never a desktop `AppShell` rail.
Primitive default: in a push/dismiss `TopBar`, a navigable back or Cancel action stays at the leading edge, the record/page title centers, and overflow stays at the trailing edge.
Compile-diagnostic candidate: keep exactly one originating bottom tab active on a pushed detail screen.
Primitive defaults make bottom-bar destinations equal 56px targets with 13px labels, set phone body/field text to 16px and metadata to 13px, and render tertiary actions as bounded 44px controls rather than underlined prose.
They also make the first field in a phone row fill the available width beside its trailing action.
For grouped settings overviews, opt into `Text role="section"` for the primitive's quiet uppercase group label; row titles and metadata inherit the body/secondary tiers, and a final Stack containing a destructive action becomes a separated danger zone.
Primitive default: a screen-level primary action immediately before `BottomBar` pins above the keyboard/safe-area position.
For keyboard-heavy screens, keep the focused field visible, hide nonessential chrome while typing, and preserve both draft content and cursor position across interruption.

### Lists, forms, actions, state

13. Easy-to-scan rows: identity, key context, state, recency; selection and urgency unmistakable (not color alone; explicit counts).
14. Focused forms; progressive disclosure; drafts; desktop label/control alignment.
15. Secondary space for intelligence (duplicates, related, routing, impact) - not empty decorative panels.
16. Model dependencies visibly (this setting enables that control).
17. Clear action hierarchy (compile-diagnostic candidate: one primary action per screen, excluding selected mode/tab controls; primitive default: a final destructive group is visually separate).
18. Visible system state (selected, disabled, empty, unsaved, loading) as labels or badges the sketch can show without polish.

Use `SegmentedControl` for mutually exclusive local modes such as Reply / Internal note.
Primitive default: an internal-note `Message` has a persistent warning tint; authors change the submit label to match the mode (`Send reply` or `Add internal note`).
Use amber/red only for SLA, destructive, or breached states; pair color with text or an icon.

### Anti-patterns

- Equal-width columns for global chrome + primary + properties.
- Ticket detail that **drops** the queue (full-page only) when the product is a triage workspace.
- Settings as two large side-by-side cards.
- Floating card sidebar with outer margin on desktop.
- Phone as a vertical iPad (AppShell rail, multi-pane, tablet card stack).
- Inflating padding and card chrome to "use" desktop width.

### Authoring checklist

1. Pattern: each screen names a proven reference archetype in surrounding prose.
2. Desktop: stable global shell; non-wrapping `list | main | rail` where the job is triage-to-record; main visibly dominates; borders stay within budget.
3. Tablet: intentional multi-column layout; do not regress it into dense desktop or stretched phone.
4. Phone: conventional top/bottom chrome; 16px body / 13px metadata; bounded 44px actions; 56px tabs; single column; whole-row list actions; keyboard/safe-area behavior; recovery.
5. Rows: long identity/context/value copy truncates predictably; selection edges reserve an inset; no overlap, clipping, or one-word-per-line wrapping.
6. State/actions: one primary action; selected/active/disabled/unsaved states visible; destructive and internal-note modes unmistakable.
7. Self-critique every screen at its declared viewport before presenting: inspect alignment, overflow, clipping, density, hierarchy, and dead space; fix the three strongest objections.

## Vocabulary

- **Frame** - `AppShell` holds `Sidebar`, an optional `TopBar`, and `AppContent`. On desktop the shell is flush-left and **stable** (same global nav every screen). Phone screens skip `AppShell` and use `TopBar` + `BottomBar`.
- **Layout** - `Stack` runs down, `Row` runs across. In a `Row`, `span="fill"` shares width and may wrap; a row with `span="list"|"main"|"rail"` is a non-wrapping desktop workspace.
- **Regions** - `Panel` bounds a region, `PageHeader` says what the page is once at the top.
- **Content** - `Metric`, `Progress`, `List` / `ListItem` (use `selected` on the active queue row), `Message` for conversation timelines (`kind` customer|agent|internal), `Text` (`role="section"` for quiet uppercase group labels), `Heading`, `Badge`, `Divider`, `ImagePlaceholder`.
- **Navigation** - `Nav` / `NavItem` for destinations; `TopBar` + `BottomBar` for conventional phone chrome. Walkable buttons use `navigateTo` without an external-link arrow glyph.
- **Modes** - `SegmentedControl` holds `Button` children for mutually exclusive modes; make the selected button primary.
- **Forms** - `TextField`, `TextArea`, `Select`, `Checkbox`, `Switch` - every control needs a `label`; use `disabled` on text/select controls when a visible dependency makes them unavailable.
- **Flow** - `Stepper` / `Step`, `Connector`.

```mdx
<Wireframe id="harbor-desktop" title="Harbor, desktop" initialScreen="ticket">
  <Screen
    id="ticket"
    name="Ticket"
    viewport="desktop"
    chrome="browser"
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
        <PageHeader
          title="Cannot complete checkout"
          description="#4821 · Maya Chen"
        >
          <Button label="Resolve" emphasis="primary" />
        </PageHeader>
        <Row gap="sm">
          <Panel span="list">
            <List>
              <ListItem
                label="Cannot complete checkout"
                meta="Priority · Maya"
                value="14m · #4821"
                selected
              />
              <ListItem label="SSO timeout" meta="Waiting · 2h" value="#4818" />
            </List>
          </Panel>
          <Panel span="main">
            <Message
              author="Maya"
              time="14m"
              kind="customer"
              text="Card form freezes on submit."
            />
            <Message
              author="Alex"
              time="8m"
              kind="agent"
              text="Could you share the cart id?"
            />
            <SegmentedControl>
              <Button label="Reply" emphasis="primary" />
              <Button label="Internal note" />
            </SegmentedControl>
            <TextArea label="Message" placeholder="Write a reply…" />
            <Button label="Send reply" emphasis="primary" />
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
