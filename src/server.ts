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

export function makeExpressServer(context: HandlerContext) {
  const { sockets, renderStatusBar, query, cardStorage } = context;
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  renderStatusBar();

  io.on("connection", async (socket) => {
    let boardId: string | null = null;
    renderStatusBar();
    socket.on("disconnect", () => {
      if (boardId) {
        sockets.delete(boardId);
      }
      renderStatusBar();
    });

    vscode.window.showInformationMessage(
      `AppExplorer Connected at socket - ${socket.id}`,
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
                    activeEditor.selection.end,
                  )
                : new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(0, 0),
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
      if (card) {
        cardStorage.setCard(url, card);
      } else {
        cardStorage.deleteCardByLink(url);
      }
    });
    boardId = await query(socket, "boardId");
    let boardInfo = await context.cardStorage.getBoard(boardId);
    if (!boardInfo) {
      boardInfo = await context.cardStorage.addBoard(boardId, boardId);
    }

    const cards = await query(socket, "cards");
    context.cardStorage.setBoardCards(boardId, cards);
  });

  app.use(compression());
  app.use(
    "/",
    express.static(path.join(__dirname, "../dist"), { index: "index.html" }),
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
