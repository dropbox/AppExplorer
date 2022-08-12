import type { Frame, Rect } from "@mirohq/websdk-types";
import { delay } from "../utils/delay";

/**
 * There's probably a much better way to handle this
 */

export async function zoomIntoFrame(frame: Frame) {
  // It seems like this promes doesn't wait for things to stop moving
  await miro.board.viewport.zoomTo(frame);

  // Here's my hacky way to see if it's done moving
  const sameRect = (a: Rect, b: Rect) =>
    a.x === b.x && a.y === b.y && a.height === b.height && a.width === b.width;
  let lastView = await miro.board.viewport.get();
  while (true) {
    await delay(100);
    const nextView = await miro.board.viewport.get();
    if (sameRect(nextView, lastView)) {
      break;
    }
    lastView = nextView;
  }

  // And then I'm zooming back out a bit to try to not cover the left panel
  await miro.board.viewport.set({
    viewport: await miro.board.viewport.get(),
    padding: {
      top: 0,
      left: 300,
      bottom: 0,
      right: 0,
    },
  });
}
