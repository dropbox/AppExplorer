import type { Shape } from "@mirohq/websdk-types";
import type { FileScanResult, TaggedComment } from "~/routes/api/scanFile";
import {
  readAppExplorerLink,
  decodeMiroContent,
  needsUpdate,
} from "./board-utilities";

type UpdatePair = [Shape, TaggedComment];

export async function checkBoardNodesForUpdates() {
  const shapes = await miro.board.get({
    type: "shape",
  });

  const fileCache = new Map<string, FileScanResult>();
  async function checkFile(filePath: string): Promise<FileScanResult> {
    if (!fileCache.has(filePath)) {
      const url = new URL("/api/scanFile", window.location.origin);
      url.searchParams.set("path", filePath);

      const response = await fetch(url);
      const data = await response.json();
      fileCache.set(filePath, data);
    }
    return fileCache.get(filePath) ?? [];
  }

  return shapes.reduce<Promise<UpdatePair[]>>(async (p, shape) => {
    const arr = await p;

    const id = readAppExplorerLink(shape);
    if (id === shape.id) {
      const [filePath] = decodeMiroContent(shape.content).split(/\s/g);

      if (filePath) {
        const results = await checkFile(filePath);
        const item = results.find(
          (i): i is TaggedComment =>
            i.type === "TaggedComment" &&
            i.rawText.includes("moveToWidget=" + shape.id)
        );
        if (item && needsUpdate(shape, item)) {
          arr.push([shape, item]);
        }
      }
    }
    return arr;
  }, Promise.resolve([]));
}
