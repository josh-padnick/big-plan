import type { ComponentDiffInput } from "./contract.js";

export type NamedField<Model> = {
  readonly name: string;
  readonly value: (model: Model) => unknown;
};

export type NamedFieldDiff<Model> = ComponentDiffInput<Model> & {
  readonly changedFields: ReadonlyArray<string>;
  readonly wholeComponent: boolean;
};

export const unionNamedFields = <Model>(
  ...catalogs: ReadonlyArray<ReadonlyArray<NamedField<Model>>>
): ReadonlyArray<NamedField<Model>> => {
  const fields = new Map<string, NamedField<Model>>();
  for (const catalog of catalogs) {
    for (const field of catalog) fields.set(field.name, field);
  }
  return [...fields.values()];
};

export const sameDiffValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left, (key, value: unknown) =>
    key === "position" ? undefined : value,
  ) ===
  JSON.stringify(right, (key, value: unknown) =>
    key === "position" ? undefined : value,
  );

/** Names model fields without moving change detection into rendered markup. */
export const compileNamedFieldDiff = <Model>(
  input: ComponentDiffInput<Model>,
  fields: ReadonlyArray<NamedField<Model>>,
): NamedFieldDiff<Model> => ({
  ...input,
  wholeComponent: input.status !== "changed",
  changedFields:
    input.status === "changed"
      ? fields
          .filter(
            (field) =>
              !sameDiffValue(
                field.value(input.baseline),
                field.value(input.proposed),
              ),
          )
          .map((field) => field.name)
      : fields.map((field) => field.name),
});
