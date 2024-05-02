import * as vscode from "vscode";
import { createServer } from "http";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";

export function makeExpressServer(
  { sockets, statusBar, allCards }: HandlerContext
) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  function renderStatusBar() {
    if (sockets.size == 0) {
      statusBar.backgroundColor = "red";
    }

    let cardsInEditor = [];
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      const path = getRelativePath(uri);
      if (path) {
        cardsInEditor = [...allCards.values()].filter(card => card.path === path)
      }
    }

    if (cardsInEditor.length > 0) {
      statusBar.text = `AppExplorer (${cardsInEditor.length} in file)`;
    } else if (allCards.size > 0) {
      statusBar.text = `AppExplorer (${allCards.size} cards)`;
    } else {
      statusBar.text = `AppExplorer (${sockets.size} sockets)`;
    }
    statusBar.show();
  }
  statusBar.command = "app-explorer.browseCards"

  renderStatusBar();

  io.on("connection", (socket) => {
    sockets.set(socket.id, socket);
    renderStatusBar();
    socket.on("disconnect", () => {
      sockets.delete(socket.id);
      renderStatusBar();
    });

    vscode.window.showInformationMessage(
      `AppExplorer Connected at socket - ${socket.id}`
    );

    socket.on("card", (card) => {
      if(card.miroLink) {
        allCards.set(card.miroLink, card);
        renderStatusBar();
      }
    });
    socket.emit("queryBoard");
  });

  app.use(compression());
  app.use(
    "/",
    express.static(path.join(__dirname, "../public"), { index: "index.html" })
  );

  app.use(morgan("tiny"));

  const port = 50505;

  // instead of running listen on the Express app, do it on the HTTP server
  httpServer.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });

  return io;
}
