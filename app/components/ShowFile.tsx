import { useFetcher } from "@remix-run/react";
import React from "react";
import type { FileScanResult } from "~/routes/api/scanFile";
import { unreachable } from "~/utils/unreachable";
import { Comment } from "./Comment";
export type FileData = {
  type: "file";
  path: string;
};

/**
 * This calls /api/scanFile?path= to asynchronously load the results of the
 * scan.
 *
 * Using the FileScanResult type with unreachable(), it enforces that we have a
 * component ready to handle every kind of result.
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084098939
 */
export function ShowFile(props: { path: string }) {
  const fetcher = useFetcher<FileScanResult>();

  React.useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      let path = props.path;
      fetcher.load(`/api/scanFile?path=${path}`);
    }
  }, [fetcher, props.path]);
  const data = fetcher.data;

  if (!data) {
    return <div>Loading data for {props.path}...</div>;
  }

  return (
    <div>
      <div className="grid">
        {data.map((item, i) => {
          switch (item.type) {
            case "TaggedComment":
              return <Comment key={i} item={item} />;
            default:
              unreachable(item.type);
          }
          return null;
        })}
      </div>

      <details>
        <summary>JSON</summary>
        <pre>{JSON.stringify(data, undefined, 2)}</pre>
      </details>
    </div>
  );
}
