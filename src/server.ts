import * as vscode from "vscode";
import { createServer } from "http";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";

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

    socket.on("navigateTo", async (card) => context.navigateToCard(card));
    socket.on("card", async ({ url, card }) => {
      if (card) {
        cardStorage.setCard(url, card);
      } else {
        cardStorage.deleteCardByLink(url);
      }
    });
    const info = await query(socket, "getBoardInfo");
    boardId = info.boardId;
    let boardInfo = await context.cardStorage.getBoard(boardId);
    if (!boardInfo) {
      boardInfo = await context.cardStorage.addBoard(boardId, info.name);
    } else if (boardInfo.name !== info.name) {
      boardInfo = context.cardStorage.setBoardName(boardId, info.name);
    }

    const cards = await query(socket, "cards");
    context.cardStorage.setBoardCards(boardId, cards);
    sockets.set(boardId, socket);
    console.log("AppExplorer set socket", boardId, info.name);
    renderStatusBar();
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
