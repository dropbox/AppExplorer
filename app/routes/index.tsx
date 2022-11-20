import type { SelectionUpdateEvent } from "@mirohq/websdk-types";
import { Link } from "@remix-run/react";
import React from "react";
import { decodeMiroContent, readPathFromShape } from "~/components/Comment";

/**
 * init() sets up listeners including:
 * - Clicking the icon for AppExplorer launches http://localhost:50505/explore/ in the sidebar
 * - Clicking a tagged comment will open /explore/ to the file path in the permalink
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084725994
 */
async function init() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "explore/" });
  });
  miro.board.ui.on("selection:update", async (event) => {
    await openTaggedComment(event);
    // As I add other types, they'll get their own functions
  });
}

async function openTaggedComment(event: SelectionUpdateEvent) {
  if (event.items.length === 1) {
    const [item] = event.items;
    if (item.type === "shape") {
      const content = decodeMiroContent(item.content);
      const hasTag = content.includes("@AppExplorer");
      if (hasTag) {
        const filePath = readPathFromShape(item);
        await miro.board.ui.openPanel({ url: "explore/" + filePath });
      }
    }
  }
}

/**
 * Index is the entry point for this plugin. Miro loads this URL in an invisible iframe
 * so that our init() can listen for events.
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084002567
 */
export default function Index() {
  React.useEffect(() => {
    init();
  }, []);
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.4" }}>
      <h1>Welcome to AppExplorer</h1>
      <p>
        If your Miro board is setup to use AppExplorer, then it'll load this
        page in an iframe. It includes the code to tell Miro what to do when we
        click on the icon for the app. That is, load the /app route
      </p>

      <h1>Development Board</h1>
      <p>
        I'm using the Miro WebSDK, which loads http://localhost:3100/ when you
        open the board in an iframe. That's this page, so this is a look behing
        the scenes.
      </p>
      <p>
        If you click on a card in Miro, then there's an event that will tell it
        to open <Link to="/explore">/explore</Link> in the sidebar. If it's
        opened in an iframe in Miro it interacts with the board. If I load it
        directly in another tab it works the same, but all my miro promises seem
        to hang forever. I think that's actually really great experience. If I'm
        working on something in the scanner, I don't need to run the process of
        rebuilding the board. I can just run it in another tab until I have the
        data I want. Then load it in Miro and work on the other half.
      </p>
    </div>
  );
}
