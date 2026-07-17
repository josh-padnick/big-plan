---
title: Development
description: Set up Big Plan locally and run its generation, build, test, lint, and browser checks.
---

Big Plan development uses Bun as the package manager and script runner.
Run these commands from the repository root.

## Install dependencies

```sh
bun install
```

## Run the core checks

```sh
bun run build
bun run test
bun run lint
```

Use `bun run test`, not `bun test`.
The shorter command invokes Bun's own test runner instead of the repository's Vitest script.

## Regenerate embedded modules

```sh
bun run gen
```

This regenerates the CSS, browser-script, and branding-asset modules.
Generated files carry `.generated.` in their names and are committed with their inputs.
CI checks for generated-file drift.

## Run the browser journey

Build before running the Playwright browser test.

```sh
bun run build
bunx playwright test
```

## Follow the contribution workflow

See the repository's `CONTRIBUTING.md` for DCO sign-off, feature branch, pull request, required check, and licensing guidance.
