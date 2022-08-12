import type { Frame, Shape } from "@mirohq/websdk-types";
import type { Dimensions } from "./index";
import { doesOverlap } from "./doesOverlap";
import { zoomIntoFrame } from "./zoomIntoFrame";

export const expandFrameToContainItem = async (
  frame: Frame,
  l: Shape | Dimensions
) => {
  const isStillOnFrame = doesOverlap(frame, l);

  if (!isStillOnFrame) {
    const xDistanceFromCenters = Math.abs(l.x - frame.x) + l.width;
    const yDistanceFromCenters = Math.abs(l.y - frame.y) + l.height;

    const height = Math.max(frame.height, yDistanceFromCenters * 2);
    const width = Math.max(frame.width, xDistanceFromCenters * 2);

    if (height !== frame.height || width !== frame.width) {
      console.log("Expanding frame", height, width);
      frame.height = height;
      frame.width = width;
      await frame.sync();
      await zoomIntoFrame(frame);
    }
  }
};
