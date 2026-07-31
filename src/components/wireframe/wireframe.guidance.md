# Using Wireframe well

A hand-drawn sketch of a product screen, drawn from a fixed vocabulary so a reviewer argues about the design rather than about the pixels.

- Reach for a wireframe when the reviewer must picture a screen to judge the plan; describe anything they can already picture in prose.
- Deliberately low fidelity is the point. Draw the regions, the copy that carries meaning, and the actions - not the polish.
- Every screen needs `id` and `name`. Add a second `Screen` and a `Button` with `navigateTo` to turn a sketch into a walkable prototype, and keep prototypes short: two or three screens along one path.
- All copy is written as attributes: `<Text text="..." />`, `<Metric label="..." value="..." />`, `<Button label="..." />`. A wireframe holds no prose, and the explanation belongs in the paragraphs around it.
- Pick the `viewport` the design is really for. The artboard reflows to the reader's width instead of shrinking the text, so the preset sets the shape rather than the final size.
- Say what kind of product this is with `chrome`. A web product uses `chrome="browser"` and a `url`, which tells a reviewer the route before they read a label; a phone screen uses `chrome="phone"`. An unframed screen floats on the page and reads as a tablet app whatever is inside it, so frame every screen of a real product and keep the frame the same across the prototype.

## Form-factor honesty

A prototype that claims three devices must actually be designed three times.
Do not scale one layout and change the caption.
Each form factor is a **native layout language**, not a stretched or shrunken version of another.

| Form factor | `viewport` | `chrome` | Shell |
| --- | --- | --- | --- |
| Desktop web SaaS | `desktop` | `browser` + `url` | `AppShell` + flush-left `Sidebar` + `AppContent`. Linear/GitHub/Notion density. |
| Tablet | `tablet-landscape` or `tablet-portrait` | `browser` when it is a web app | Master/detail, wider gutters, card surfaces OK. |
| Phone | `mobile-portrait` | `phone` | Single column. `TopBar` + `BottomBar`. No left rail. |

When the same product must be reviewed on more than one form factor, author parallel prototypes (separate `Wireframe` blocks or clearly labeled sections), each with its own screens and navigation path.
Do not mix phone chrome with a desktop sidebar on one screen.

## Visual mockup best practices by form factor

These rules are the bar for multi-device showcases.
Tablet quality is the reference; desktop and phone must feel equally intentional.
Prefer real product references: Linear/GitHub/Notion for desktop, iOS HIG for phone, iPadOS multi-column for tablet.

### Desktop web SaaS

**Pass when:** the drawing reads as a professional B2B web app, not a large tablet inside a browser frame.

**Shell**

- Flush-left sidebar rail hard against the browser content edge, full height.
- Narrow nav rail (short labels) - not a third of the canvas.
- Main canvas claims most of the width.

**Detail / master layouts (ticket, document, canvas)**

- The primary surface dominates: conversation, document, or canvas at roughly 60-75% of the main column.
- Secondary panes (properties, metadata, related) are narrow rails.
- Use `span="main"` on the primary `Panel` or `Stack`, and `span="rail"` on secondary ones.
- Do **not** put equal-width panels in a `Row` for app chrome + primary + properties - that becomes equal thirds.

**Settings / admin**

- Prefer Linear-style settings: a settings **sub-nav** (`span="rail"` list of sections) plus **one dense field column** (`span="main"`).
- Do **not** stack two large equal cards side-by-side like a tablet dashboard unless the real product does that.
- Prefer vertical form rhythm, tighter gaps, full-width field groups inside the content column.

**Density**

- Tighter vertical rhythm than tablet; more information per viewport.
- Create/edit as full-page routes or true modals - not oversized iPad sheets.

**Anti-patterns**

- Ticket detail with conversation and properties as equal thirds.
- Settings as two large floating cards sharing the main canvas.
- Floating card sidebar with outer margin (the shell is flush by default; do not invent card chrome around the rail).

### Tablet / iPad

**Pass when:** intentional multi-column tablet UI - master/detail and card surfaces are welcome.

- Wider gutters and card-like sidebar are fine; the tablet treatment is deliberate.
- Equal-width panels in a `Row` often fit tablet master/detail.
- Do not force desktop density (narrow rails, cramped settings columns) onto tablet.

### Phone / iPhone

**Pass when:** true mobile - **not** a vertical iPad.

**Must**

- `viewport="mobile-portrait"` with `chrome="phone"` (tall, narrow device frame).
- Single column only.
- Primary destinations in `BottomBar` (optionally a compact `TopBar` for title/actions).
- Touch-sized controls; fewer fields per screen; progressive disclosure.
- List → detail push navigation, not multi-pane side-by-side.

**Anti-patterns**

- Desktop/tablet `AppShell` with a left nav squeezed into a tall artboard.
- Side-by-side property columns on phone.
- The same card layout as iPad with only the viewport height changed.

### Authoring checklist

Before parking a multi-form-factor showcase:

1. Desktop: primary content width clearly greater than secondary rails (`span="main"` / `span="rail"`); settings Linear-like.
2. Tablet: multi-column intentional; still great - do not regress.
3. Phone: bottom nav, single column, phone chrome, no vertical-iPad shell.
4. Guidance followed so the next agent does not re-learn these from screenshots.

## Vocabulary

- **Frame** - `AppShell` holds `Sidebar`, an optional `TopBar`, and `AppContent`. Reach for it whenever the screen sits inside a product, and skip it for a single focused page. On desktop the shell is flush-left; on tablet it keeps breathing room. Phone screens skip `AppShell` and use `TopBar` + `BottomBar`.
- **Layout** - `Stack` runs down, `Row` runs across. Panels in a `Row` share width by default (`span="fill"`). On desktop detail screens set `span="main"` and `span="rail"`.
- **Regions** - `Panel` bounds a region, `PageHeader` says what the page is once at the top.
- **Content** - `Metric` for the number a screen exists to show, `Progress` for how far along something is, `List` and `ListItem` for repeated rows, `Text`, `Heading`, `Badge`, `Divider`, and `ImagePlaceholder` for art nobody has drawn yet.
- **Navigation** - `Nav` and `NavItem`, with `active` on the current destination. A `NavItem` takes `navigateTo` just like a button. On a phone, put primary destinations in `BottomBar` instead of a sidebar.
- **Forms** - `TextField`, `TextArea`, `Select`, `Checkbox`, and `Switch` draw as the real controls. Every one needs a `label`; an unlabelled box has not decided what the field is for.
- **Flow** - `Stepper` and `Step` show where the user is in a multi-step create flow; `Connector` is the arrow between two steps on a canvas, labeled with the condition that follows it.

```mdx
<Wireframe id="harbor-desktop" title="Harbor, desktop" initialScreen="ticket">
  <Screen
    id="ticket"
    name="Ticket"
    viewport="desktop"
    chrome="browser"
    url="app.harbor.team/tickets/4821"
  >
    <AppShell>
      <Sidebar brand="Harbor" mode="Acme Support">
        <Nav label="Main">
          <NavItem label="Inbox" navigateTo="inbox" />
          <NavItem label="Settings" navigateTo="settings" />
        </Nav>
      </Sidebar>
      <AppContent>
        <PageHeader title="#4821 Checkout freeze" badge="Priority" />
        <Row gap="sm">
          <Panel title="Conversation" span="main">
            <List>
              <ListItem label="Maya" meta="14m" value="Form freezes" />
            </List>
            <TextArea label="Reply" placeholder="Write a reply..." />
            <Button label="Send reply" emphasis="primary" />
          </Panel>
          <Stack gap="sm" span="rail">
            <Panel title="Properties">
              <Select label="Status" value="Open" />
              <Select label="Assignee" value="Alex" />
            </Panel>
            <Panel title="Related">
              <List>
                <ListItem label="Prior freeze" meta="Resolved" value="#4410" />
              </List>
            </Panel>
          </Stack>
        </Row>
      </AppContent>
    </AppShell>
  </Screen>
  <Screen
    id="settings"
    name="Settings"
    viewport="desktop"
    chrome="browser"
    url="app.harbor.team/settings"
  >
    <AppShell>
      <Sidebar brand="Harbor">
        <Nav label="Main">
          <NavItem label="Inbox" navigateTo="inbox" />
          <NavItem label="Settings" active />
        </Nav>
      </Sidebar>
      <AppContent>
        <PageHeader title="Settings" />
        <Row gap="sm">
          <Panel span="rail">
            <Nav label="Settings sections">
              <NavItem label="Notifications" active />
              <NavItem label="Business hours" />
            </Nav>
          </Panel>
          <Stack gap="sm" span="main">
            <Heading text="Notifications" level="2" />
            <Switch label="Email on assignment" on />
            <Switch label="Slack on Sla risk" on />
            <Button label="Save" emphasis="primary" />
          </Stack>
        </Row>
      </AppContent>
    </AppShell>
  </Screen>
</Wireframe>
```
