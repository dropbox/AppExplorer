import React from "react";
import "@mirohq/websdk-types"
import { Link } from "@remix-run/react";

async function init() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "/lsp" });
  });
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