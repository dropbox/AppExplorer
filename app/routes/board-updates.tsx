import type { Shape } from "@mirohq/websdk-types";
import React from "react";
import { checkBoardNodesForUpdates } from "~/components/checkBoardNodesForUpdates";
import { Comment } from "~/components/Comment";
import type { TaggedComment } from "~/routes/api/scanFile";

export default function BoardUpdates() {
  const [updates, setUpdates] = React.useState<Array<
    [Shape, TaggedComment]
  > | null>(null);

  React.useEffect(() => {
    console.log("?", updates);
    if (updates == null) {
      checkBoardNodesForUpdates().then(setUpdates);
    }
  }, [updates]);

  console.log("render", updates);
  if (updates == null) {
    return (
      <div className="centered cs2 ce11">Scanning objects on board...</div>
    );
  }
  if (updates.length === 0) {
    return <div className="centered cs2 ce11">No updates found</div>;
  }

  return (
    <div className="grid">
      {updates.map(([, item], i) => (
        <Comment key={i} item={item} />
      ))}
    </div>
  );
}
