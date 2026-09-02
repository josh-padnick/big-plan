export const canMountReviewBlockHost = (block: HTMLElement): boolean =>
  block.closest("[inert]") === null;
