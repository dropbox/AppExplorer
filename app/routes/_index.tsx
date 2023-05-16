import React from "react";
import "@mirohq/websdk-types"
import { Link } from "@remix-run/react";

async function init() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "/lsp" });
  });

  miro.board.ui.on('selection:update', async (event) => {
    if (event.items.length === 1) {
      const item = event.items[0]
      const data = await item.getMetadata()
      if (data.projectName && data.path) {
        const url = `/lsp/${data.projectName}/plugin/AppExplorer/view-file/?path=${data.path}`
        await miro.board.ui.openPanel({ url });
      }
    }
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