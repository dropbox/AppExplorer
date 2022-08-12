import type { Connector } from "@mirohq/websdk-types";
import { theme } from "./theme";

export async function connectItems(start: string, end: string) {
  const connections = await miro.board.get({
    type: "connector",
  });

  let connector: Connector | undefined = connections.flatMap((c) => {
    if (c.type === "connector") {
      if (c.start?.item === start && c.end?.item === end) {
        return c;
      }
    }
    return [];
  })[0];

  if (!connector) {
    connector = await miro.board.createConnector({
      start: { item: start },
      end: { item: end },
      style: theme.defaultLine,
    });
  } else {
    Object.assign(connector.style, theme.defaultLine);
    await connector.sync();
  }

  return connector;
}
