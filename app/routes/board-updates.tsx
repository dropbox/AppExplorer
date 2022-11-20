import type { Shape } from "@mirohq/websdk-types";
import React from "react";
import { updateCommentNode } from "~/components/board-utilities";
import { checkBoardNodesForUpdates } from "~/components/checkBoardNodesForUpdates";
import { Comment } from "~/components/Comment";
import type { TaggedComment } from "~/routes/api/scanFile";

export default function BoardUpdates() {
  const [updates, setUpdates] = React.useState<Array<
    [Shape, TaggedComment]
  > | null>(null);

  React.useEffect(() => {
    if (updates == null) {
      checkBoardNodesForUpdates().then(setUpdates);
    }
  }, [updates]);

  if (updates == null) {
    return (
      <div className="centered cs2 ce11">Scanning objects on board...</div>
    );
  }
  if (updates.length === 0) {
    return <div className="centered cs2 ce11">No updates found</div>;
  }

  return (
    <div>
      <div className="grid">
        {updates.map(([shape, item], i) => (
          <Comment
            key={i}
            item={item}
            update={shape}
            onUpdate={async () => {
              await updateCommentNode(shape, item);
              setUpdates(
                (updates) => updates?.filter(([s]) => shape !== s) ?? null
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
