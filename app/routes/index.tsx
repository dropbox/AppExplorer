import { Link } from "@remix-run/react";
import React from "react";

/**
 * Listens for events on the board:
 * - clicked the icon (/browse in the sidebar)
 * - clicked an app card (/browse/path/to/file in sidebar)
 *
 * @AppExplorer
 */
async function init() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "explore/" });
  });
}

/**
 * Miro loads this page in an invisible iframe that listens to events and opens
 * the sidebar for AppExplorer
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

      <iframe
        title="Miro development board"
        src="https://miro.com/app/live-embed/uXjVOk9T9PU=/?moveToViewport=-7382,-339,7264,4167&embedId=205241659823"
        scrolling="no"
        allowFullScreen
        width="767"
        height="440"
        frameBorder="0"
      ></iframe>
    </div>
  );
}
