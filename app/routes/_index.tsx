import React from "react";
import "@mirohq/websdk-types"
import { Link } from "@remix-run/react";

async function init() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "/lsp" });
  });

  miro.board.ui.on('selection:update', async (event) => {
    event.items.forEach(async (item) => {
      console.log(
        item.id,
        await item.getMetadata('path')
      )
    })
  })
}

export default function Index() {
  React.useEffect(() => {
    init();
  }, []);
  return (
    <div>
      <Link to="/lsp">LSP</Link>

    </div>
  );
}