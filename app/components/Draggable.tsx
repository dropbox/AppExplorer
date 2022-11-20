import type { DropEvent } from "@mirohq/websdk-types";
import React from "react";

/**
 * Miro's onDrop gives you the DOM node of whatever was dragged. That means I need
 * some way of identifying exactly what item was dragged. This component keeps
 * that detail in this component and I just render a `<Draggable onDrop`.
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084099504
 */
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
      className="miro-draggable cs2 ce11"
      data-id={id}
      style={{ position: "relative" }}
    >
      {children}
    </div>
  );
}
