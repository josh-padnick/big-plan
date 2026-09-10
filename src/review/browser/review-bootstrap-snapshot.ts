import { isReviewWireRecord } from "../shared/review-wire.js";

export const reviewBootstrapSnapshot = (serialized: string | null): string => {
  try {
    const value: unknown = JSON.parse(serialized ?? "{}");
    return isReviewWireRecord(value) &&
      typeof value.currentSnapshot === "string"
      ? value.currentSnapshot
      : "";
  } catch {
    return "";
  }
};

export const bootstrapMatchesDisplayedSnapshot = ({
  serialized,
  displayedSnapshot,
}: {
  readonly serialized: string | null;
  readonly displayedSnapshot: string;
}): boolean => reviewBootstrapSnapshot(serialized) === displayedSnapshot;
