/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServer } from "http";
import * as path from "path";
import type { Socket } from "socket.io";
import { Server } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { CardData, Queries, RequestEvents, ResponseEvents } from "./EventTypes";
import { HandlerContext } from "./extension";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { BoardInfo } from "./card-storage";
import { logger } from "./ChannelLogger";

export function isWebserverRunning() {
  return fetch("http://localhost:50505")
    .then((res) => res.ok)
    .catch(() => false);
}

export type MiroEvents =
  | {
      type: "connect";
      boardInfo: BoardInfo;
    }
  | { type: "disconnect" }
  | { type: "navigateToCard"; card: CardData }
  | {
      type: "updateCard";
      miroLink: CardData["miroLink"];
      card: CardData | null;
    };

export class MiroServer extends vscode.EventEmitter<MiroEvents> {
  subscriptions = [] as vscode.Disposable[];

  constructor(private context: HandlerContext) {
    super();
    this.init();
  }

  init() {
    const app = express();
    const httpServer = createServer(app);
    this.subscriptions.push({
      dispose: () => {
        httpServer.closeAllConnections();
      },
    });
    const io = new Server<ResponseEvents, RequestEvents>(httpServer);
    io.on("connection", this.onConnection.bind(this));

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
      vscode.window.showInformationMessage(
        `AppExplorer - Server started. Open a Miro board to connect.`,
      );
    });
  }

  destroy() {
    this.subscriptions.forEach((s) => s.dispose());
  }

  async onConnection(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket: Socket<ResponseEvents, RequestEvents, DefaultEventsMap, any>,
  ) {
    logger.log("onConnection");
    const { context } = this;
    const info = await querySocket(socket, "getBoardInfo");
    const boardId = info.boardId;
    socket.once("disconnect", () => {
      this.fire({ type: "disconnect" });
    });
    socket.on("navigateTo", async (card) =>
      this.fire({ type: "navigateToCard", card }),
    );
    socket.on("card", async ({ url, card }) => {
      this.fire({ type: "updateCard", miroLink: url, card });
    });

    let boardInfo = context.cardStorage.getBoard(boardId);
    logger.log("Stored board info", !!boardInfo);
    if (!boardInfo) {
      boardInfo = await context.cardStorage.addBoard(boardId, info.name);
    } else if (boardInfo.name !== info.name) {
      await context.cardStorage.setBoardName(boardId, info.name);
      boardInfo = { ...boardInfo, name: info.name };
    }
    const cards = await querySocket(socket, "cards");
    context.cardStorage.connectBoard(boardId, socket);
    await context.cardStorage.setBoardCards(boardId, cards);
    const storedCards = context.cardStorage.getBoard(boardId)?.cards;
    logger.log("cards", cards?.length);
    logger.log("Stored cards", Object.keys(storedCards ?? {}).length);
    this.fire({ type: "connect", boardInfo });
  }
  async query<Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    boardId: string,
    name: Req,
    ...data: Parameters<Queries[Req]>
  ): Promise<Res> {
    const socket = this.context.cardStorage.getBoardSocket(boardId);
    invariant(socket, `No connection to board ${boardId}`);
    return querySocket<Req, Res>(socket, name, ...data);
  }
}

async function querySocket<
  Req extends keyof Queries,
  Res extends ReturnType<Queries[Req]>,
>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: Socket<ResponseEvents, RequestEvents, DefaultEventsMap, any>,
  name: Req,
  ...data: Parameters<Queries[Req]>
): Promise<Res> {
  const requestId = Math.random().toString(36);
  return new Promise<Res>((resolve) => {
    socket.emit("query", {
      name,
      requestId,
      data,
    });
    socket.once("queryResult", (response) => {
      resolve(response.response as any);
    });
  });
}
