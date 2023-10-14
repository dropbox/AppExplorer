import * as vscode from "vscode";
import { createServer } from "http";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { Handler, RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";

export function makeExpressServer(
  cardsInEditor: Handler<ResponseEvents["cardsInEditor"]>,
  { sockets, statusBar }: HandlerContext
) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  function renderStatusBar() {
    if (sockets.size == 0) {
      statusBar.backgroundColor = "red";
    }
    statusBar.text = `AppExplorer (${sockets.size})`;
    statusBar.show();
  }

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

    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      const path = getRelativePath(uri);
      if (path) {
        io.emit("activeEditor", path);
      }
    }

    socket.on("cardsInEditor", cardsInEditor);
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
