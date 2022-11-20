import type { Item, Shape } from "@mirohq/websdk-types";
import { diffStringsUnified } from "jest-diff";
import { useFetcher } from "@remix-run/react";
import React from "react";
import { theme } from "~/chart/theme";
import type { FileScanResult, TaggedComment } from "~/routes/api/scanFile";
import { Draggable } from "./Draggable";
import { formatContentForMiro, decodeMiroContent } from "./board-utilities";

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
export function Comment({
  item,
  update,
  onUpdate,
}: {
  item: TaggedComment;
  update?: Shape;
  onUpdate?: () => void;
}) {
  const updateFetcher = useFetcher<FileScanResult>();
  const widgetId = React.useMemo(() => {
    const match = item.rawText.match(/@AppExplorer (http.*)/);
    const url = match?.[1];
    if (url) {
      const tmp = new URL(url);
      return tmp.searchParams.get("moveToWidget")?.replace(/[^\d]/g, "");
    }
    return null;
  }, [item.rawText]);


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
      {onUpdate && (
        <button
          className="cs6 ce8"
          onClick={() => {
            onUpdate();
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
