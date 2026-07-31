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

| Form factor | `viewport` | `chrome` | Shell |
| --- | --- | --- | --- |
| Desktop web SaaS | `desktop` | `browser` + `url` | Stable `AppShell` + flush-left `Sidebar` + `AppContent`. Workspace density. |
| Tablet | `tablet-landscape` or `tablet-portrait` | `browser` when it is a web app | Master/detail, wider gutters, card surfaces OK. |
| Phone | `mobile-portrait` | `phone` | Single column. `TopBar` + `BottomBar`. No left rail. |

When the same product must be reviewed on more than one form factor, author parallel prototypes (separate `Wireframe` blocks or clearly labeled sections), each with its own screens and navigation path.
Do not mix phone chrome with a desktop sidebar on one screen.

## Central product principle

**Use desktop width to keep relevant context visible, not to make containers and controls larger.**

Design each interface around the user's primary job.
Make the next action obvious, preserve context, minimize interruption.

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
8. Support **keyboard-speed** workflows: search / Cmd+K, list J/K, Enter to open, Cmd+Enter to send or create, multi-select, visible focus and selection.

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

Phone musts: `viewport="mobile-portrait"`, `chrome="phone"`, single column, `BottomBar` for primary destinations, no desktop `AppShell` rail.

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
- Inflating padding and card chrome to "use" desktop width.

### Authoring checklist

1. Desktop: stable global shell on every screen; master-detail where the job is triage-to-record; `span="list"|"main"|"rail"` proportions; keyboard hints where they matter.
2. Tablet: multi-column intentional; do not regress.
3. Phone: essential jobs only; bottom nav; list → detail; recovery affordances sketched.
4. No "enjoyable momentum" theater - only clarity, context, and next action.

## Vocabulary

- **Frame** - `AppShell` holds `Sidebar`, an optional `TopBar`, and `AppContent`. On desktop the shell is flush-left and **stable** (same global nav every screen). Phone screens skip `AppShell` and use `TopBar` + `BottomBar`.
- **Layout** - `Stack` runs down, `Row` runs across. In a `Row`, `span="fill"` shares width; `span="list"` is a master queue; `span="main"` is the primary surface; `span="rail"` is secondary properties or settings sub-nav.
- **Regions** - `Panel` bounds a region, `PageHeader` says what the page is once at the top.
- **Content** - `Metric`, `Progress`, `List` / `ListItem`, `Text`, `Heading`, `Badge`, `Divider`, `ImagePlaceholder`.
- **Navigation** - `Nav` / `NavItem` for destinations; `BottomBar` for phone primary destinations.
- **Forms** - `TextField`, `TextArea`, `Select`, `Checkbox`, `Switch` - every control needs a `label`.
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
        <PageHeader title="Inbox" description="12 open">
          <Text text="Cmd+K search · J/K move · Enter open" role="helper" />
        </PageHeader>
        <Row gap="sm">
          <Panel title="Queue" span="list">
            <List>
              <ListItem label="Checkout freeze" meta="Selected · 14m" value="#4821" />
              <ListItem label="SSO timeout" meta="Waiting · 2h" value="#4818" />
            </List>
          </Panel>
          <Panel title="Conversation" span="main">
            <List>
              <ListItem label="Maya · Customer" meta="14m" value="Form freezes" />
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
