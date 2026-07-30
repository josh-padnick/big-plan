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

| Form factor | `viewport` | `chrome` | Shell |
| --- | --- | --- | --- |
| Desktop web SaaS | `desktop` | `browser` + `url` | `AppShell` + flush-left `Sidebar` + `AppContent`. Professional B2B density (Linear, Notion, GitHub), not a centered sheet. |
| Tablet | `tablet-landscape` or `tablet-portrait` | `browser` when it is a web app; keep the same product frame across the tablet path | Master/detail and wider gutters are fine; the tablet treatment is deliberate, not a shrunken desktop. |
| Phone | `mobile-portrait` | `phone` | Single column. Compact `TopBar` and/or `BottomBar` for destinations. No desktop sidebar rail. |

Desktop rules that keep a shell from reading as "iPad adapted for desktop":

- Use `viewport="desktop"` with `chrome="browser"` and a real `url`.
- Put navigation in `Sidebar` inside `AppShell`. The shell is flush to the artboard edge by default; do not invent outer margins or floating card chrome around the rail.
- Create and onboarding flows are full web pages (or a real modal over the shell), not iOS-style sheets floating on a tablet canvas.
- Keep density high: page header, list or table of work, primary action. Avoid oversized empty regions that look like a phone artboard stretched wide.

Tablet may use the same `AppShell`, but the drawing relaxes gutters so the device still feels like a tablet.
Phone drops the rail: stack the work, put destinations in `BottomBar`, and keep touch targets as ordinary buttons in that strip.

When the same product must be reviewed on more than one form factor, author parallel prototypes (separate `Wireframe` blocks or clearly labeled sections), each with its own screens and navigation path.
Do not mix phone chrome with a desktop sidebar on one screen.

The vocabulary, by what it is for:

- **Frame** - `AppShell` holds `Sidebar`, an optional `TopBar`, and `AppContent`. Reach for it whenever the screen sits inside a product, and skip it for a single focused page. On desktop the shell is flush-left; on tablet it keeps breathing room.
- **Layout** - `Stack` runs down, `Row` runs across. Panels in a `Row` share the width; buttons and copy keep their own size.
- **Regions** - `Panel` bounds a region, `PageHeader` says what the page is once at the top.
- **Content** - `Metric` for the number a screen exists to show, `Progress` for how far along something is, `List` and `ListItem` for repeated rows, `Text`, `Heading`, `Badge`, `Divider`, and `ImagePlaceholder` for art nobody has drawn yet.
- **Navigation** - `Nav` and `NavItem`, with `active` on the current destination. A `NavItem` takes `navigateTo` just like a button. On a phone, put primary destinations in `BottomBar` instead of a sidebar.
- **Forms** - `TextField`, `TextArea`, `Select`, `Checkbox`, and `Switch` draw as the real controls. Every one needs a `label`; an unlabelled box has not decided what the field is for.
- **Flow** - `Stepper` and `Step` show where the user is in a multi-step create flow; `Connector` is the arrow between two steps on a canvas, labeled with the condition that follows it.

```mdx
<Wireframe id="harbor-desktop" title="Harbor, desktop" initialScreen="inbox">
  <Screen
    id="inbox"
    name="Inbox"
    viewport="desktop"
    chrome="browser"
    url="app.harbor.team/inbox"
  >
    <AppShell>
      <Sidebar brand="Harbor" mode="Acme Support">
        <Nav label="Main">
          <NavItem label="Inbox" active />
          <NavItem label="Compose" navigateTo="compose" />
          <NavItem label="Settings" navigateTo="settings" />
        </Nav>
      </Sidebar>
      <AppContent>
        <PageHeader title="Inbox" description="Open conversations.">
          <Button label="New ticket" emphasis="primary" navigateTo="compose" />
        </PageHeader>
        <Panel>
          <List>
            <ListItem label="Billing refund" meta="Open" value="2h" />
            <ListItem label="SSO timeout" meta="Waiting" value="1d" />
          </List>
        </Panel>
      </AppContent>
    </AppShell>
  </Screen>
  <Screen
    id="compose"
    name="New ticket"
    viewport="desktop"
    chrome="browser"
    url="app.harbor.team/tickets/new"
  >
    <AppShell>
      <Sidebar brand="Harbor" mode="Acme Support">
        <Nav label="Main">
          <NavItem label="Inbox" navigateTo="inbox" />
          <NavItem label="Compose" active />
          <NavItem label="Settings" navigateTo="settings" />
        </Nav>
      </Sidebar>
      <AppContent>
        <PageHeader title="New ticket" description="A full page, not a sheet." />
        <Panel title="Details">
          <TextField label="Subject" placeholder="Customer cannot sign in" />
          <TextArea label="Description" placeholder="What happened?" />
          <Button label="Create ticket" emphasis="primary" navigateTo="inbox" />
        </Panel>
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
        <PageHeader title="Workspace settings" />
        <Panel title="Notifications">
          <Switch label="Email on assignment" on />
        </Panel>
      </AppContent>
    </AppShell>
  </Screen>
</Wireframe>
```
