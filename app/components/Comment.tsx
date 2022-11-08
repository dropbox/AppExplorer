import { useFetcher } from "@remix-run/react";
import React from "react";
import { theme } from "~/chart/theme";
import type { FileScanResult, TaggedComment } from "~/routes/api/scanFile";
import { Draggable } from "./Draggable";

type Update = {
  widgetId: string;
  content: string;
};

export function Comment({ item }: { item: TaggedComment }) {
  const updateFetcher = useFetcher<FileScanResult>();
  const [update, setUpdate] = React.useState<null | Update>(null);

  async function applyUpdate() {
    if (!update) return;

    try {
      // This throws if the item isn't found
      const shape = await miro.board.getById(update.widgetId);
      if (shape && shape.type === "shape" && shape.content !== update.content) {
        shape.content = update?.content;
        await shape.sync();
        setUpdate(null);
      }
    } catch (e) {
      // ignore
    }
  }

  React.useEffect(() => {
    async function checkForUpdates() {
      const match = item.rawText.match(/@AppExplorer (http.*)/);
      const url = match?.[1];
      if (url) {
        const tmp = new URL(url);
        const widgetId = tmp.searchParams.get("moveToWidget");
        if (widgetId) {
          const content = item.rawText.replace(/\n/g, "<br />");
          try {
            // This throws if the item isn't found
            const shape = await miro.board.getById(widgetId);
            if (shape && shape.type === "shape" && shape.content !== content) {
              setUpdate({ widgetId, content });
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }
    checkForUpdates();
  }, [item.rawText]);

  return (
    <Draggable
      onDrop={async (x, y) => {
        const shape = await miro.board.createShape({
          x,
          y,
          width: 700,
          shape: "round_rectangle",
          style: {
            ...theme.jsDoc,
          },
        });
        await shape.sync();

        const content = item.rawText.replace(
          /@AppExplorer\s?.*/,
          `@AppExplorer https://miro.com/app/board/${
            (await miro.board.getInfo()).id
          }/?moveToWidget=${shape.id}`
        );

        shape.content = content.replace(/\n/g, "<br/>");
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
        }}
      >
        {item.rawText}
      </pre>
      {update != null && (
        <button
          style={{
            position: "absolute",
            right: 0,
            top: 0,
          }}
          onClick={applyUpdate}
        >
          update
        </button>
      )}
    </Draggable>
  );
}
