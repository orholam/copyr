import { generateKeyBetween } from "fractional-indexing";

/**
 * Stable kanban ordering via fractional indexes (rocicorp/fractional-indexing).
 * Keys sort lexicographically; either bound may be null for prepend/append.
 */
export { generateKeyBetween };

export function initialKey(): string {
  return "a0";
}
