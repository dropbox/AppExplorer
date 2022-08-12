import type { Frame } from "@mirohq/websdk-types";
import { constructionArea } from ".";
import { doesOverlap } from "./doesOverlap";

export async function findSpaceForFrame(frame: Frame) {
  if (doesOverlap(frame, constructionArea)) {
    // https://dropbox.slack.com/archives/C02KGQSCS5B/p1658872679374619
    // I'm working around an issue where I need to always create my objects at
    // the origin and then move the frame when I'm done.
    const frames = await miro.board.get({ type: "frame" });

    let direction = 0;
    const constructionSize = Math.max(
      constructionArea.width,
      constructionArea.height
    );
    const frameSize = Math.max(frame.width, frame.height);
    let radius = constructionSize + frameSize;

    let candidateLocation = {
      // y: 0,
      x: radius * Math.cos(direction),
      y: radius * Math.sin(direction),
      width: frame.width,
      height: frame.height,
    };

    let blockingFrame;
    do {
      blockingFrame = frames.find((f) => doesOverlap(f, candidateLocation));
      if (blockingFrame) {
        direction += Math.PI / 3;
        if (direction > 1) {
          direction -= 1;
          radius += frameSize;
        }
      }
    } while (blockingFrame);

    frame.x = candidateLocation.x;
    frame.y = candidateLocation.y;
  }

  await miro.board.viewport.zoomTo(frame);
}
