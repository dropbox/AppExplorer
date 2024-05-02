import * as vscode from "vscode";
import { createServer } from "http";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";
import { goToCardCode } from "./make-browse-handler";

export function makeExpressServer(
  { sockets, renderStatusBar, allCards, selectedCards }: HandlerContext
) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

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

    socket.on("selectedCards", (event) => {
      selectedCards.length = 0
      selectedCards.push(...event.data.map((card) => card.miroLink));
      if (selectedCards.length === 1) {
        const card = event.data[0];
        goToCardCode(card)
      }
    })

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
