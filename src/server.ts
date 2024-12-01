import * as vscode from "vscode";
import { createServer } from "http";
import type { Socket } from "socket.io";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { CardData, RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";
import { QueryHandler, QueryRequestEvent } from "./query-handler";

export function makeExpressServer(
  context: HandlerContext,
  sockets: Map<string, Socket<ResponseEvents, RequestEvents>>,
  navigateToCard: (card: CardData, preview?: boolean) => Promise<boolean>,
) {
  const subscriptions = [] as vscode.Disposable[];
  const { renderStatusBar } = context;
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  renderStatusBar();

  io.on("connection", async (socket) => {
    let boardId: string = `tmp-${Math.random().toString(36).substring(2)}`;
    sockets.set(boardId, socket);
    const tmp = context.queryHandler.listenToBoard(boardId, handleRequest);
    socket.on("queryResult", (response) => {
      context.queryHandler.resolve(response.requestId, response.response);
    });
    async function handleRequest(event: QueryRequestEvent) {
      socket.emit("query", {
        name: event.request,
        requestId: event.requestId,
        data: event.data,
      });
      return QueryHandler.defer;
    }

    const info = await context.queryHandler.query(boardId, "getBoardInfo");
    tmp.dispose();
    sockets.delete(boardId);
    boardId = info.boardId;
    sockets.set(boardId, socket);
    subscriptions.push(
      context.queryHandler.listenToBoard(boardId, handleRequest),
    );

    renderStatusBar();
    socket.on("disconnect", () => {
      if (boardId) {
        context.connectedBoards.delete(boardId);
        sockets.delete(boardId);
      }
      renderStatusBar();
    });

    socket.on("navigateTo", async (card) => navigateToCard(card));
    socket.on("card", async ({ url, card }) => {
      if (card) {
        context.cardStorage.setCard(url, card);
      } else {
        context.cardStorage.deleteCardByLink(url);
      }
    });
    let boardInfo = context.cardStorage.getBoard(boardId);
    if (!boardInfo) {
      boardInfo = await context.cardStorage.addBoard(boardId, info.name);
    } else if (boardInfo.name !== info.name) {
      boardInfo = context.cardStorage.setBoardName(boardId, info.name);
    }

    const cards = await context.queryHandler.query(boardId, "cards");
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

  return {
    dispose() {
      subscriptions.forEach((s) => s.dispose());
    },
  };
}
