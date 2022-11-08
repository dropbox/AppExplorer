import type { DropEvent } from "@mirohq/websdk-types";
import React from "react";
import { getPositionOfLineAndCharacter } from "typescript";

export function Draggable({
  onDrop,
  children,
}: React.PropsWithChildren<{ onDrop: (x: number, y: number) => void }>) {
  const [id] = React.useState(() => Math.random().toString(36));
  React.useEffect(() => {
    async function handleDrop({ x, y, target }: DropEvent) {
      if (target.dataset.id === id) {
        onDrop(x, y);
      }
    }

    miro.board.ui.on("drop", handleDrop);
    return () => miro.board.ui.off("drop", handleDrop);
  }, [id, onDrop]);

  return (
    <div
      className="miro-draggable"
      data-id={id}
      style={{ position: "relative" }}
    >
      {children}
    </div>
  );
}
