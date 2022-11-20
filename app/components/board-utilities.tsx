import type { Shape } from "@mirohq/websdk-types";
import type { TaggedComment } from "~/routes/api/scanFile";
import { htmlToText } from "html-to-text";

export const PermalinkRegex = /<a href="(.+)">(.+)<\/a>/;
export function formatContentForMiro(item: TaggedComment) {
  const permalink = `<a href="${item.permalink}">${item.filePath}</a>`;
  return (
    permalink +
    ("\n\n" + item.rawText)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br />")
      .trim()
  );
}

export function readPathFromShape(shape: Shape) {
  const [filePath] = decodeMiroContent(shape.content).split(/\s/g);
  // @TODO: How can I validate this is a path and not just the first line of a custom shape?
  return filePath;
}

export function decodeMiroContent(string: string) {
  const tmp = htmlToText(string, {
    wordwrap: false,
  }).trim();

  // console.log("decoded:", JSON.stringify(tmp));
  return tmp;
}

export function readAppExplorerLink(shape: Shape) {
  const content = decodeMiroContent(shape.content);
  const match = content.match(/@AppExplorer (http[^\s]+)/);
  let url = match?.[1];
  if (url) {
    const tmp = new URL(url);
    return tmp.searchParams.get("moveToWidget")?.replace(/[^\d]/g, "");
  }
  return null;
}

export async function getBoardCommentFromId(
  widgetId: string
): Promise<null | Shape> {
  try {
    // This throws if the item isn't found
    const shape = await miro.board.getById(widgetId);
    if (shape && shape.type === "shape") {
      const id = readAppExplorerLink(shape);
      if (id && id === widgetId) {
        return shape;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function needsUpdate(shape: Shape, item: TaggedComment): boolean {
  let a = decodeMiroContent(shape.content);
  let b = decodeMiroContent(formatContentForMiro(item));
  a = ignorePermalink(a);
  b = ignorePermalink(b);

  function ignorePermalink(content: string) {
    return content
      .replace(/blob\/[a-fA-F0-9]+/, "blob/XXXX")
      .replace(/#L\d+\]/g, "#LXX]");
  }
  if (a !== b) {
    // console.log(JSON.stringify({ board: a, code_: b }, null, 2));
    return true;
  }
  return false;
}

export async function updateCommentNode(shape: Shape, update: TaggedComment) {
  shape.content = formatContentForMiro(update);
  await shape.sync();
}
