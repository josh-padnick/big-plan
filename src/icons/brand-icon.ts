// Defines the framework-neutral shape shared by local vendor brand-mark icon
// data. Unlike the Lucide catalog, a brand mark is a filled shape on its own
// source-defined canvas rather than a stroked line on a shared 24x24 grid.

type BrandIconNode = ReadonlyArray<
  readonly [tagName: string, properties: Readonly<Record<string, string>>]
>;

export type BrandIcon = {
  readonly name: string;
  readonly viewBox: string;
  readonly node: BrandIconNode;
};
