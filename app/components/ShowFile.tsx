import type { DropEvent } from "@mirohq/websdk-types";
import { useFetcher } from "@remix-run/react";
import React from "react";
import { theme } from "~/chart/theme";
import type { FileScanResult } from "~/routes/api/scanFile";
import { unreachable } from "~/utils/unreachable";
export type FileData = {
  type: "file";
  path: string;
};

/**
 * This calls /api/scanFile?path= to asynchronously load the results of the
 * scan.
 *
 * @AppExplorer
 */
export function ShowFile(props: { path: string }) {
  const fetcher = useFetcher<FileScanResult>();
  const updateFetcher = useFetcher<FileScanResult>();

  React.useEffect(() => {
    console.log("Checking fetcher...", fetcher.state);
    if (fetcher.state === "idle" && !fetcher.data) {
      let path = props.path;
      fetcher.load(`/api/scanFile?path=${path}`);
    }
  }, [fetcher, props.path]);
  const data = fetcher.data;

  React.useEffect(() => {
    async function onDrop({ x, y, target }: DropEvent) {
      const type = target.dataset.type as FileScanResult[number]["type"];
      console.log({ x, y, type, target });

      switch (type) {
        case "TaggedComment": {
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

          const content = target.textContent!.replace(
            /@AppExplorer\s?.*/,
            `@AppExplorer https://miro.com/app/board/${
              (await miro.board.getInfo()).id
            }/?moveToWidget=${shape.id}`
          );

          shape.content = content.replace(/\n/g, "<br/>");
          await shape.sync();

          updateFetcher.submit(
            {
              filePath: target.dataset.filePath!,
              line: target.dataset.line!,
              content,
            },
            {
              method: "post",
              action: "/api/scanFile",
            }
          );

          break;
        }
        default:
          unreachable(type);
      }
    }

    miro.board.ui.on("drop", onDrop);
    return () => miro.board.ui.off("drop", onDrop);
  });

  if (!data) {
    return <div>Loading data for {props.path}...</div>;
  }

  return (
    <div>
      {data.map((item) => {
        switch (item.type) {
          case "TaggedComment":
            return (
              <pre
                className="miro-draggable"
                data-type={item.type}
                data-line={item.commentStartLine}
                data-file-path={item.filePath}
                style={{
                  backgroundColor: theme.jsDoc.fillColor,
                  borderRadius: "16px",
                  padding: "16px",
                  border: `1px solid black`,
                }}
              >
                {item.rawText}
              </pre>
            );
          default:
            unreachable(item.type);
        }
        return null;
      })}

      <details>
        <summary>JSON</summary>
        <pre>{JSON.stringify(data, undefined, 2)}</pre>
      </details>
    </div>
  );
}
