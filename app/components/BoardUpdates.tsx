import type { Shape } from "@mirohq/websdk-types";
import React from "react";
import type { TaggedComment } from "~/routes/api/scanFile";
import { checkBoardNodesForUpdates } from "./checkBoardNodesForUpdates";
import { Comment } from "./Comment";

export default function BoardUpdates() {
  const [updates, setUpdates] = React.useState<Array<
    [Shape, TaggedComment]
  > | null>(null);

  return (
    <div>
      <button onClick={() => checkBoardNodesForUpdates().then(setUpdates)}>
        Check for updates
      </button>

      {updates &&
        updates.map(([_shape, item], i) => <Comment key={i} item={item} />)}

      {updates?.length === 0 && <div>No updates found</div>}
    </div>
  );
}
