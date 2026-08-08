# Contributing to Big Plan

Thanks for contributing!
The workflow is intentionally light:

- **DCO sign-off.** Every commit must be signed off: `git commit -s`. This certifies the [Developer Certificate of Origin](https://developercertificate.org/).
- **Feature branches.** Branch off `main` and open a pull request back into `main`.
- **Small PRs.** Keep pull requests small and reviewable; prefer several self-contained increments over one large change.
- **Checks.** Run `bun run lint`, `bun run build`, `bun run test`, and `bun run test:e2e` before opening a pull request; CI enforces the same checks on branches pushed to this repository.
- **License.** Big Plan is [MIT](LICENSE) licensed; contributions are accepted under the same license.

## Styling changes

There is no pixel-history CI gate and no visual contract in commit subjects.
Visual quality is established by human review of the rendered review document plus the ordinary checks above.

When you change anything a reader sees:

- Pick values from the scales in [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md) rather than inventing new ones.
- Render an affected example, such as `node bin/big-plan.mjs render examples/all-components.mdx`, and read the result in both themes at desktop and phone widths before opening the pull request.
- Keep `bun run lint` green: the stylesheet-contract and design-system checks enforce the CSS escape-hatch rules and the declaration ratchet.
- Describe the intended visual change in the pull request so a reviewer knows what to look at.

See [AGENTS.md](AGENTS.md) for architecture, [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md) for the design scales a visual change picks from, [ENGINEERING_PRACTICES.md](ENGINEERING_PRACTICES.md) for engineering practices, and [README.md](README.md) for development commands.

Wireframe changes must also pass the rendered geometry fence in `test/wireframe-quality.spec.ts`.
That browser check renders the proof and form-factor showcase documents at their declared device sizes and rejects cramped panes, overlapping regions, dead layout bands, and device-shell mismatches.
Run it alone with `bun run test:e2e -- test/wireframe-quality.spec.ts`.
