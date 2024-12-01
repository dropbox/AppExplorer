import * as vscode from "vscode";
import { createServer } from "http";
import type { Socket } from "socket.io";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";

export function makeExpressServer(
  context: HandlerContext,
  sockets: Map<string, Socket<ResponseEvents, RequestEvents>>,
) {
  const { renderStatusBar, cardStorage } = context;
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  renderStatusBar();

  io.on("connection", async (socket) => {
    let boardId: string | null = null;
    renderStatusBar();
    socket.on("disconnect", () => {
      if (boardId) {
        context.connectedBoards.delete(boardId);
        sockets.delete(boardId);
      }
      renderStatusBar();
    });

    socket.on("navigateTo", async (card) => context.navigateToCard(card));
    socket.on("card", async ({ url, card }) => {
      if (card) {
        cardStorage.setCard(url, card);
      } else {
        cardStorage.deleteCardByLink(url);
      }
    });
    const info = await context.query(socket, "getBoardInfo");
    boardId = info.boardId;
    let boardInfo = context.cardStorage.getBoard(boardId);
    if (!boardInfo) {
      boardInfo = await context.cardStorage.addBoard(boardId, info.name);
    } else if (boardInfo.name !== info.name) {
      boardInfo = context.cardStorage.setBoardName(boardId, info.name);
    }

    const cards = await context.query(socket, "cards");
    context.cardStorage.setBoardCards(boardId, cards);
    sockets.set(boardId, socket);
    context.connectedBoards.add(boardId);
    vscode.window.showInformationMessage(
      `AppExplorer - ${boardInfo?.name ?? boardId}`,
    );
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
