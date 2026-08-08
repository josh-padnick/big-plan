// Defines the framework-neutral shape shared by local Lucide icon-node data.

type IconNode = ReadonlyArray<
  readonly [tagName: string, properties: Readonly<Record<string, string>>]
>;

export type LucideIcon = {
  readonly name: string;
  readonly node: IconNode;
  readonly strokeWidth?: string;
};
