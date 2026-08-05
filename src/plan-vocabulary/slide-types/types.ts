// Owns the framework-free contract shared by every slide-type definition:
// stable identity, structural facts, matching boundaries, authoring guidance,
// and the built-in components that help present that guidance.

export type SlideTypeId =
  | "status-quo"
  | "desired-experience"
  | "desired-outcome"
  | "user-journey"
  | "acceptance-criteria";

export type SlideTypeCardinality = "one" | "many";

export type SlideTypePlacement = "anywhere" | "last-typed";

export type SlideTypeComponentPairing = {
  readonly name: string;
  readonly guidance: string;
  readonly required?: boolean;
};

export type SlideTypeDefinition = {
  readonly id: SlideTypeId;
  readonly name: string;
  readonly match: {
    readonly when: string;
    readonly notWhen: string;
  };
  readonly cardinality: SlideTypeCardinality;
  readonly placement: SlideTypePlacement;
  readonly guidance: ReadonlyArray<string>;
  readonly components: ReadonlyArray<SlideTypeComponentPairing>;
};
