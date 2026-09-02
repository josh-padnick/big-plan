---
title: Change how the viewer looks
description: Appearance, colour theme, and the covering note that rides with an approval.
---

**Goal.** A review document that reads the way you want it to, and an approval note you are
happy to send.

## Before you start

Nothing. Settings work in a live review and in a standalone rendered document alike, and every
choice is saved for every Big Plan document in this browser rather than for one plan.

## Open Settings

A standalone document opens Settings from the branding bar's gear.
A live review opens it from **More actions**, after **Export**.

Settings is a sidebar of pages beside the page you pick, so every setting is its own page and
a new one joins the sidebar instead of lengthening an existing page.
On wide screens that sidebar is a narrow column beside a dominant content pane; on phones it
becomes a compact row of pages above a single column, wrapping onto a second row rather than
scrolling sideways.

## Appearance

`Light`, `Dark`, and `System`.
The choice applies immediately, is saved for every review document in this browser, and is
applied before the first paint so the other appearance never flashes.
`System` follows your OS preference, and is what you get on a first run or when the browser
refuses storage.

## Color theme

`Default`, `Rosé Pine`, `Nord`, `Catppuccin`, and `Brutalist`.

A theme is a palette rather than a mode: each one works in both light and dark, appearance
still decides which, and every swatch previews that theme's own shades.
The choice applies immediately, is saved across review documents, and is restored before the
first paint.

`Default` is Big Plan's warm paper look and is what a document with no saved choice renders.
`Brutalist` also squares cards and controls, replaces the soft shadows with hard offset slabs,
and sets one weight heavier, so it changes the shape of the reading surface and not only its
colours; pill-shaped badges stay round.

## Approval message

The covering note sent to the agent with a plan approval.
One note covers every plan; there is no separate one per plan.

It starts from a standard wording, accepts up to 2,000 characters, and saves as you type.
**Reset to default** puts the standard wording back, and emptying the field does the same
thing: a blank note falls back to the standard wording, so an approval never carries nothing.

## Verify

- The page repaints in the appearance and palette you chose, without a flash on the next
  reload.
- The approval confirmation dialog shows the note you wrote; it also offers **Edit in
  Settings**, which closes the dialog and opens this page.

## If it goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| The approval field says it could not save | The browser refused storage | The field keeps what you typed; copy it somewhere before closing the tab |
| Your appearance choice does not persist | The browser is refusing site storage, so `System` is used | Allow storage for the page's origin, or accept the OS default |
| A theme looks wrong in one appearance | Every theme ships coordinated light and dark variants, so this is a defect | [Report it](/concepts/security-policy/) or open an issue |

## Next

[When a review goes wrong](/review/troubleshooting/) — every review failure, with its symptom
and its fix.
