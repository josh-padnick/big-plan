# assets/fonts/

Start with the [agent guide](../../AGENTS.md); the root [README](../../README.md) owns the generation commands.

This directory owns the bundled typefaces a rendered document embeds.
A rendered document makes zero external requests, so any typeface it uses ships inside it.
Each bundled font binary is an authored input to `scripts/gen-fonts.mjs`; the generated stylesheet is a derived output.

Add a typeface only when a component's visual language genuinely needs letterforms the reader's system cannot supply, and only under a license that permits embedding and redistribution.
Record it below with its license, its source, and the character range it covers, so the licensing question never has to be re-answered from the binary.

| File                                          | Typeface     | License                   | Source                                | Coverage                                         |
| --------------------------------------------- | ------------ | ------------------------- | ------------------------------------- | ------------------------------------------------ |
| `noto-sans-latin-400-normal.woff2`            | Noto Sans    | SIL Open Font License 1.1 | Fontsource 5.3.0, `latin` subset      | Latin, U+0000-00FF plus punctuation and currency |
| `noto-sans-latin-600-normal.woff2`            | Noto Sans    | SIL Open Font License 1.1 | Fontsource 5.3.0, `latin` subset      | Latin, U+0000-00FF plus punctuation and currency |
| `noto-sans-latin-700-normal.woff2`            | Noto Sans    | SIL Open Font License 1.1 | Fontsource 5.3.0, `latin` subset      | Latin, U+0000-00FF plus punctuation and currency |
| `noto-sans-sc-87-{400,600,700}-normal.woff2`  | Noto Sans SC | SIL Open Font License 1.1 | Fontsource 5.3.0, numbered subset 87  | Gallery glyph `✅`, U+2705                       |
| `noto-sans-sc-116-{400,600,700}-normal.woff2` | Noto Sans SC | SIL Open Font License 1.1 | Fontsource 5.3.0, numbered subset 116 | Gallery glyph `始`, U+59CB                       |
| `noto-sans-sc-118-{400,600,700}-normal.woff2` | Noto Sans SC | SIL Open Font License 1.1 | Fontsource 5.3.0, numbered subset 118 | Gallery glyph `开`, U+5F00                       |
| `patrick-hand-400.woff2`                      | Patrick Hand | SIL Open Font License 1.1 | Google Fonts, v25, `latin` subset     | Latin, U+0000-00FF plus punctuation and currency |

License texts live beside the fonts they cover, named `<font>-OFL.txt`.
