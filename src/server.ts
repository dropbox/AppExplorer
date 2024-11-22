import * as vscode from "vscode";
import { createServer } from "http";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";
import { findCardDestination, goToCardCode } from "./make-browse-handler";
import { getGitHubUrl } from "./get-github-url";

export function makeExpressServer({
  sockets,
  renderStatusBar,
  resetCardList,
  setCard,
  query,
}: HandlerContext) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  renderStatusBar();

  io.on("connection", async (socket) => {
    sockets.set(socket.id, socket);
    renderStatusBar();
    socket.on("disconnect", () => {
      sockets.delete(socket.id);
      renderStatusBar();
    });

    vscode.window.showInformationMessage(
      `AppExplorer Connected at socket - ${socket.id}`
    );

    socket.on("navigateTo", async (card) => {
      const dest = await findCardDestination(card);

      // Only connect if it's able to reach the symbol
      const status = (await goToCardCode(card)) ? "connected" : "disconnected";
      if (card.miroLink) {
        let codeLink: string | null = null;
        if (dest) {
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor) {
            const uri = activeEditor.document.uri;
            const selection =
              status === "connected"
                ? new vscode.Range(
                    activeEditor.selection.start,
                    activeEditor.selection.end
                  )
                : new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(0, 0)
                  );

            const def: vscode.LocationLink = {
              targetUri: uri,
              targetRange: selection,
            };
            codeLink = await getGitHubUrl(def);
          }
        }
        socket.emit("cardStatus", {
          miroLink: card.miroLink,
          status,
          codeLink,
        });
      }
    });
    socket.on("card", async ({ url, card }) => {
      setCard(url, card);
    });

    const cards = await query(socket, "cards");
    if (cards.length > 0) {
      resetCardList(cards);
    }
    renderStatusBar();
  });

  app.use(compression());
  app.use(
    "/",
    express.static(path.join(__dirname, "../dist"), { index: "index.html" })
  );

  app.use(morgan("tiny"));

  const port = 50505;

  httpServer.on("error", (e) => {
    vscode.window.showErrorMessage(`AppExplorer - ${String(e)}`);
  });
  httpServer.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });

  return io;
}
