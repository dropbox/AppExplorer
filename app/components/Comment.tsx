import type { Item, Shape } from "@mirohq/websdk-types";
import { diffStringsUnified } from "jest-diff";
import { useFetcher } from "@remix-run/react";
import React from "react";
import { theme } from "~/chart/theme";
import type { FileScanResult, TaggedComment } from "~/routes/api/scanFile";
import { Draggable } from "./Draggable";
import { htmlToText } from "html-to-text";

export const PermalinkRegex = /<a href="(.+)">(.+)<\/a>/;

function formatContentForMiro(item: TaggedComment) {
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

async function updateCommentNode(shape: Shape, update: TaggedComment) {
  shape.content = formatContentForMiro(update);
  await shape.sync();
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

async function getBoardCommentFromId(widgetId: string): Promise<null | Shape> {
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
    console.log(JSON.stringify({ board: a, code_: b }, null, 2));
    return true;
  }
  return false;
}
/**
 * <Comment renders a TaggedComment from scanAppExplorerComments.
 *
 * This component must:
 * 1. Render a preview in HTML
 * 2. When it's dragged onto the board, construct the appropriate shape(s) with Miro's API
 * 3. Identify existing copies of the current comment so they can be updated
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084099358
 */
export function Comment({ item }: { item: TaggedComment }) {
  const updateFetcher = useFetcher<FileScanResult>();
  const [update, setUpdate] = React.useState<Shape | null>(null);
  const widgetId = React.useMemo(() => {
    const match = item.rawText.match(/@AppExplorer (http.*)/);
    const url = match?.[1];
    if (url) {
      const tmp = new URL(url);
      return tmp.searchParams.get("moveToWidget")?.replace(/[^\d]/g, "");
    }
    return null;
  }, [item.rawText]);

  React.useEffect(() => {
    async function checkForUpdates() {
      if (widgetId) {
        const shape = await getBoardCommentFromId(widgetId);
        if (shape && needsUpdate(shape, item)) {
          setUpdate(shape);
        }
      }
    }
    checkForUpdates();
  }, [item, item.rawText, widgetId]);

  return (
    <>
      <Draggable
        onDrop={async (x, y) => {
          const shape = await miro.board.createShape({
            x,
            y,
            width: 700,
            height: 300,
            shape: "round_rectangle",
            style: {
              ...theme.jsDoc,
            },
          });
          await shape.sync();

          let content = item.rawText.replace(
            /@AppExplorer\s?.*/,
            `@AppExplorer https://miro.com/app/board/${
              (await miro.board.getInfo()).id
            }/?moveToWidget=${shape.id}`
          );

          shape.content = formatContentForMiro({
            ...item,
            rawText: content,
          });

          await shape.sync();

          updateFetcher.submit(
            {
              filePath: item.filePath,
              line: String(item.commentStartLine),
              content,
            },
            {
              method: "post",
              action: "/api/scanFile",
            }
          );
        }}
      >
        <pre
          style={{
            backgroundColor: theme.jsDoc.fillColor,
            borderRadius: "16px",
            padding: "16px",
            border: `1px solid black`,
            overflowX: "auto",
          }}
        >
          {update
            ? diffStringsUnified(
                decodeMiroContent(update.content),
                decodeMiroContent(formatContentForMiro(item)),
                {
                  aAnnotation: "board",
                  bAnnotation: "code",
                }
              )
            : item.rawText}
        </pre>
      </Draggable>
      {update && (
        <button
          className="cs6 ce8"
          onClick={() => {
            updateCommentNode(update, item).then(() => setUpdate(null));
          }}
        >
          update
        </button>
      )}
      {widgetId && (
        <button
          className="cs9 ce11"
          onClick={async () => {
            const shape = (await miro.board.getById(widgetId)) as Item;
            miro.board.viewport.zoomTo(shape);
          }}
        >
          Go to
        </button>
      )}
      <hr className="hr cs2 ce11" />
    </>
  );
}
