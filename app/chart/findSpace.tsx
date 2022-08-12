import type { AppCard, Item, Shape } from "@mirohq/websdk-types";
import { delay } from "../utils/delay";
import type { Dimensions } from "./index";
import { doesOverlap } from "./doesOverlap";

let moveMarker: Shape | undefined;

export async function cleanupMoveMarker() {
  if (moveMarker != null) {
    await miro.board.remove(moveMarker);
    moveMarker = undefined;
    // const oldFrame = await miro.board.getById(moveMarker.parentId)
    // if (oldFrame.type === 'frame') {
    //   // await oldFrame.remove(moveMarker)
    // }
  }
}

let direction = 0;
export async function findSpace(
  initialStartingPosition: Dimensions,
  node: Shape | null,
  description: string,
  frameChildren: Array<Item>
): Promise<Dimensions> {
  let l = {
    ...initialStartingPosition,
  };

  const MAX_TRIES = 50;
  let tries = 0;
  let overlappingItem: Shape | AppCard | undefined;

  const children = await miro.board.get();
  if (moveMarker == null) {
    await cleanupMoveMarker();

    moveMarker = await miro.board.createShape({
      shape: "rectangle",
      content: "Debug Marker",
      style: {
        fillColor: "#ff0000",
      },
      ...initialStartingPosition,
      height: 50,
      width: 250,
    });
  }

  moveMarker.x = l.x;
  moveMarker.y = l.y;
  await moveMarker.sync();

  do {
    checkOverlaps();
    if (overlappingItem) {
      if (overlappingItem.type === "shape") {
        console.log("Tries", tries, overlappingItem.content);
      } else if (overlappingItem.type === "app_card") {
        console.log("Tries", tries, overlappingItem.title);
      }

      moveMarker.x = l.x;
      moveMarker.y = l.y;
      await moveMarker.sync();
      tries++;
      await nextLocation(overlappingItem);
    }
  } while (tries < MAX_TRIES && overlappingItem);
  if (tries >= MAX_TRIES) {
    console.warn("Max tries exceeded");
  }

  moveMarker.x = 0;
  moveMarker.y = 0;

  return { ...l };

  // ===================================================
  function checkOverlaps() {
    overlappingItem = children.flatMap((c) => {
      // an item can't overlap with itself
      if (node && "id" in node && node.id === c.id) {
        return [];
      }

      if (c.type === "shape" || c.type === "app_card") {
        const tmp = doesOverlap(c, l);
        if (tmp) {
          if (c.type === "shape") {
            console.log("overlap with", c.content, tmp);
          } else if (c.type === "app_card") {
            console.log("overlap with", c.title, tmp);
          }
          return c;
        }
      }
      return [];
    })[0];
  }

  async function debugLocation(n = 1000) {
    if (moveMarker) {
      moveMarker.x = l.x;
      moveMarker.y = l.y;
      await moveMarker.sync();
      await miro.board.viewport.zoomTo(frameChildren.concat(moveMarker));
    }
    if (n) {
      await delay(n);
    }
  }

  async function nextLocation(avoidNode: Shape | AppCard | null) {
    await pickARadialDirection(avoidNode);
    await debugLocation(0);
  }

  /**
   *
   * @TODO Figure out a better way to select a new location
   *
   * I tried to make it look around in a circle, and if it goes all the way
   * around it expands the radius. It realy just picks things over toward the
   * right and I'm not sure why.  It works good enough for now though HACK WEEK!
   *
   */
  function pickARadialDirection(avoidNode: Shape | AppCard | null) {
    const initialStepDistance =
      Math.max(
        initialStartingPosition.height,
        initialStartingPosition.width,
        ...(avoidNode != null ? [avoidNode.height, avoidNode.width] : [])
      ) * 2;
    let stepDistance = initialStepDistance;

    let totalRotation = 0;

    console.group("rotate", description);
    do {
      console.group("rotate");
      do {
        const s = (Math.PI * 2) / 4;
        totalRotation += s;
        direction += s;
        while (direction > 1) {
          direction -= 2;
        }

        console.log("direction", direction);
        l.x = initialStartingPosition.x;
        l.y = initialStartingPosition.y;
        l.x += stepDistance * Math.cos(direction);
        l.y += stepDistance * Math.sin(direction);
        // await debugLocation()
        checkOverlaps();
      } while (overlappingItem && totalRotation < 2);
      console.groupEnd();
      if (overlappingItem) {
        stepDistance += initialStepDistance;
        console.log("stepDistance", stepDistance);
      }
    } while (overlappingItem);
    console.groupEnd();
  }
}
