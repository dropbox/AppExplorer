import type { Dimensions } from "./index";
import { padding } from "./index";

export const doesOverlap = (a: Dimensions, b: Dimensions) => {
  // horizontal distance is less than 1/2 the width of the larger object
  if (Math.abs(a.x - b.x) < Math.max(a.width / 2, b.width / 2) + padding) {
    // vertica distance is less than 1/2 the height of the larger object
    if (Math.abs(a.y - b.y) < Math.max(a.height / 2, b.height / 2) + padding) {
      return true;
    }
  }
  return false;
};
