# assets/fonts/

Start with the [agent guide](../../AGENTS.md); the root [README](../../README.md) owns the generation commands.

This directory owns the bundled typefaces a rendered document embeds.
A rendered document makes zero external requests, so any typeface it uses ships inside it.
Every file here is an authored input to `scripts/gen-fonts.mjs`; the generated stylesheet is a derived output.

Add a typeface only when a component's visual language genuinely needs letterforms the reader's system cannot supply, and only under a license that permits embedding and redistribution.
Record it below with its license, its source, and the character range it covers, so the licensing question never has to be re-answered from the binary.

| File                     | Typeface     | License                   | Source                            | Coverage                                         |
| ------------------------ | ------------ | ------------------------- | --------------------------------- | ------------------------------------------------ |
| `patrick-hand-400.woff2` | Patrick Hand | SIL Open Font License 1.1 | Google Fonts, v25, `latin` subset | Latin, U+0000-00FF plus punctuation and currency |

License texts live beside the fonts they cover, named `<font>-OFL.txt`.
