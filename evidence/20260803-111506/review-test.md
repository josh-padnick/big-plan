# Toggle round 4 quick review

Reviewed at 1440 × 1000 in Chrome, in light and dark themes.

## Wallet — minimized

Three things a picky reviewer could flag:

1. The stage edge repeated the already visible iPad bezel without grouping anything new.
   Fixed by removing the stage’s inset border while retaining the toolbar’s internal divider.
2. The compact maximize icon did not share the Screen comments button’s centerline.
   Fixed by giving the icon control the toolbar’s 36px control geometry; measured center delta is 0px in both themes.
3. Whole-screen comments could escape into plan-wide chrome.
   Fixed by routing the screen action into the wireframe-local composer and leaving the plan rail closed.

## Wallet — maximized feedback

Three things a picky reviewer could flag:

1. The green tray action inherited wireframe ink, losing intended contrast.
   Fixed at the cause: product-control isolation now stops at `.wireframe-artboard`, so viewer chrome keeps its own foreground in both themes.
2. `Screen comments (n)` promoted the wireframe but did not immediately reveal the local tray.
   Found during Chrome verification and fixed by repainting comment-only collectors on the shared maximize lifecycle.
3. A premature global handoff could clear local notes or imply integration exists.
   Fixed with one explicit send stub that reports the unavailable integration and retains every local note.

## Harbor form factors — minimized viewer

Three things a picky reviewer could flag:

1. The repeated stage edge added noise around each already bounded device.
   Fixed through the shared minimized shell.
2. Screen comments and maximize could drift vertically from one another.
   Fixed through the shared toolbar geometry and measured at a 0px center delta.
3. Component feedback could summon unrelated plan UI.
   Fixed at the shared wireframe boundary; screen and element comments remain local for every form factor.

## Gesture evidence

- Light: created a whole-screen note, used `Screen comments (1)` to open the local tray, enabled Comment Mode, hovered and selected **Ask a grown-up**, created an element note, and exercised the send stub.
- Dark: toggled Comment Mode off and on, hovered and selected **See all**, created another element note, and exercised the send stub.
- In both themes the plan rail stayed hidden, the global draft count stayed at zero, and the local notes remained after the stub.
