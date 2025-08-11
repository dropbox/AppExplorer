import { TagColor } from "@mirohq/websdk-types/stable/features/widgets/tag";
import compression from "compression";
import createDebug from "debug";
import express from "express";
import { createServer } from "http";
import morgan from "morgan";
import * as path from "path";
import { Namespace, Server, Socket as ServerSocket } from "socket.io";
import { Socket as ClientSocket } from "socket.io-client";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { BoardInfo, CardStorage, MemoryAdapter } from "./card-storage";
import {
  AppExplorerTag,
  CardData,
  MiroToWorkspaceOperations,
  ServerToSidebarOperations,
  ServerToWorkspaceEvents,
  SidebarToServerOperations,
  WorkspaceInfo,
  WorkspaceRegistrationRequest,
  WorkspaceRegistrationResponse,
  WorkspaceToMiroOperations,
  WorkspaceToServerOperations,
} from "./EventTypes";
import { FeatureFlagManager } from "./feature-flag-manager";
import { logger } from "./logger";
import { PortConfig } from "./port-config";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { bindHandlers } from "./utils/bindHandlers";
const debug = createDebug("app-explorer:server");
const debugEvents = debug.extend("events");

/**
 * Error class for exhaustive switch statement checking
 */
class UnreachableError extends Error {
  constructor(item: never) {
    super(`Unexpected value found at runtime: ${item as string}`);
    this.name = "UnreachableError";
  }
}

export type MiroServerSocket = ServerSocket<
  MiroToWorkspaceOperations,
  WorkspaceToMiroOperations
>;

export type WorkspaceServerSocket = ServerSocket<
  WorkspaceToMiroOperations & WorkspaceToServerOperations,
  MiroToWorkspaceOperations & ServerToWorkspaceEvents
>;

export class MiroServer {
  subscriptions = [] as vscode.Disposable[];
  httpServer: ReturnType<typeof createServer>;
  private workspaceNamespace: Namespace<
    WorkspaceToMiroOperations & WorkspaceToServerOperations,
    MiroToWorkspaceOperations & ServerToWorkspaceEvents
  >;
  sidebarNamespace: Namespace<
    SidebarToServerOperations,
    ServerToSidebarOperations
  >;
  private connectedWorkspaces = new Map<string, WorkspaceInfo>();

  private cardStorage = new CardStorage(new MemoryAdapter());
  #featureFlagManager: FeatureFlagManager;
  #port: number;
  #workspaceHost: string;

  public static publicPath = path.join(__dirname, "../public");
  constructor(
    featureFlagManager: FeatureFlagManager,
    workspaceHost: string,
    port: number = PortConfig.getServerPort(),
  ) {
    this.#featureFlagManager = featureFlagManager;
    this.#port = port;
    this.#workspaceHost = workspaceHost;
    listenToAllEvents(this.cardStorage, (eventName, ...args) => {
      debug("Server storage event", eventName, ...args);
    });
    const app = express();
    this.httpServer = createServer(app);
    app.use(compression());
    app.use(
      "/",
      express.static(MiroServer.publicPath, {
        index: "index.html",
      }),
    );

    app.use(morgan("tiny"));

    // Add health check endpoint for server discovery
    app.get("/health", (_req, res) => {
      res.json({ status: "healthy", timestamp: new Date().toISOString() });
    });

    app.get("/storage", (_req, res) => {
      res.json({
        workspaceHost: this.#workspaceHost,
        connectedBoards: this.cardStorage.getConnectedBoards(),
        cardsByBoard: this.cardStorage.getCardsByBoard(),
      });
    });

    const io = new Server<MiroToWorkspaceOperations, WorkspaceToMiroOperations>(
      this.httpServer,
    );
    io.on("connection", this.onMiroConnection.bind(this));
    // Create workspace namespace
    debug("io.of /workspace");
    this.workspaceNamespace = io.of("/workspace");
    this.setupWorkspaceNamespace();

    debug("io.of /sidebar");
    this.sidebarNamespace = io.of("/sidebar");
    this.setupSidebarNamespace();
  }
  setupSidebarNamespace() {
    // Handle sidebar connections
    this.sidebarNamespace.on("connection", (socket) => {
      this.onSidebarConnection(socket);
    });
  }
  onSidebarConnection(
    socket: ServerSocket<SidebarToServerOperations, ServerToSidebarOperations>,
  ) {
    debug("New sidebar connection", { socketId: socket.id });
    const cardsByBoard = this.cardStorage.getCardsByBoard();
    const allBoards = Object.keys(cardsByBoard)
      .map((id) => this.cardStorage.getBoard(id))
      .filter((board): board is BoardInfo => board !== null);

    socket.use((event, next) => {
      debug("sidebar event", event);
      next();
    });
    debug("on getServerStatus");
    socket.on("getServerStatus", (callback) => {
      debug("getServerStatus", callback);
      try {
        callback({
          allBoards,
          connectedWorkspaces: Array.from(
            this.connectedWorkspaces.values(),
          ).map((workspace) => ({
            ...workspace,
            socket: undefined,
          })),
          connectedBoardIds: this.cardStorage.getConnectedBoards(),
          cardsPerBoard: Object.fromEntries(
            Object.entries(cardsByBoard).map(([boardId, cards]) => [
              boardId,
              cards.length,
            ]),
          ),
        });
      } catch (e) {
        debug("Error", String(e));
      }
    });
  }

  private setupWorkspaceNamespace() {
    // Handle workspace connections
    this.workspaceNamespace.on("connection", (socket) => {
      this.onWorkspaceConnection(socket);
    });

    // Set up global event listeners to broadcast to all workspaces
    this.cardStorage.on("connectedBoards", (event) => {
      this.workspaceNamespace.emit("connectedBoards", event.boardIds);
    });
    this.cardStorage.on("boardUpdate", (event) => {
      this.workspaceNamespace.emit("boardUpdate", event.board);
    });
    this.cardStorage.on("cardUpdate", (event) => {
      this.workspaceNamespace.emit("cardUpdate", event.miroLink, event.card);
    });
    this.cardStorage.on("selectedCards", (event) => {
      this.workspaceNamespace.emit("selectedCards", event.cards);
    });
  }

  /**
   * Create and start a MiroServer instance with proper error handling
   */
  static async create(
    featureFlagManager: FeatureFlagManager,
    workspaceId: string,
    port?: number,
  ): Promise<MiroServer> {
    // Use provided port, or fall back to configured port
    const serverPort = port ?? PortConfig.getServerPort();
    const server = new MiroServer(featureFlagManager, workspaceId, serverPort);
    await server.startServer();
    return server;
  }

  /**
   * Start the HTTP server with proper error handling
   */
  private async startServer(): Promise<void> {
    const port = this.#port;

    return new Promise((resolve, reject) => {
      // Set up error handling for port binding failures
      this.httpServer.on("error", (error) => {
        if ("code" in error && error.code === "EADDRINUSE") {
          debug("Port already in use", {
            port,
            error: error.message,
          });
          reject(
            new Error(
              `Port ${port} is already in use. Another server instance may be running.`,
            ),
          );
        } else {
          debug("Server error", { error });
          reject(error);
        }
      });

      // Start listening on the port
      this.httpServer.listen(port, () => {
        debug("Server started successfully", { port });
        resolve();
      });
    });
  }

  /**
   * Handle workspace websocket connection
   */
  private async onWorkspaceConnection(
    socket: WorkspaceServerSocket,
  ): Promise<void> {
    debug("New workspace connection", { socketId: socket.id });
    socket.onAny((event, ...args) => {
      debugEvents("Received workspace event", socket.id, {
        event,
        args,
      });
    });
    socket.onAnyOutgoing((event, ...args) => {
      debugEvents("Sending workspace event", socket.id, {
        event,
        args,
      });
    });
    socket.on("disconnect", () => {
      debug("Workspace socket disconnected", { id: socket.id });
    });

    const connectedWorkspaces = this.connectedWorkspaces;
    const cardStorage = this.cardStorage;

    cardStorage
      .on("connectedBoards", (event) => {
        debug("Card storage connected boards updated", {
          boardIds: event.boardIds,
        });
        socket.emit("connectedBoards", event.boardIds);
      })
      .on("boardUpdate", (event) => {
        if (event.board) {
          socket.emit("boardUpdate", event.board);
        }
      })
      .on("cardUpdate", (event) => {
        socket.emit("cardUpdate", event.miroLink, event.card);
      })
      .on("selectedCards", (event) => {
        socket.emit("selectedCards", event.cards);
      });

    const serverQueries: WorkspaceToServerOperations = {
      /**
       * Handle workspace registration request
       */
      workspaceRegistration: (
        request: WorkspaceRegistrationRequest,
        callback: (response: WorkspaceRegistrationResponse) => void,
      ): void => {
        debug("Workspace registration request", request);

        try {
          // Create workspace info
          const workspaceInfo: WorkspaceInfo = {
            id: request.workspaceId,
            socket,
            rootPath: request.rootPath,
            workspaceName: request.workspaceName,
          };

          // Store workspace connection
          connectedWorkspaces.set(request.workspaceId, workspaceInfo);

          // Join the workspace room so the client can receive events sent to this workspace
          // socket.join(request.workspaceId);
          debug("Workspace client", {
            workspaceId: request.workspaceId,
            socketId: socket.id,
          });

          // Send successful registration response
          const response: WorkspaceRegistrationResponse = {
            success: true,
            workspaceId: request.workspaceId,
            cardsByBoard: this.cardStorage.getCardsByBoard(),
          };

          debug("Workspace registered successfully", {
            workspaceId: request.workspaceId,
          });
          callback(response);
        } catch (error) {
          debug("Workspace registration failed", {
            workspaceId: request.workspaceId,
            error,
          });
          const response: WorkspaceRegistrationResponse = {
            success: false,
            workspaceId: request.workspaceId,
            error: String(error),
            cardsByBoard: this.cardStorage.getCardsByBoard(),
          };
          callback(response);
        }
      },
    };

    const miroOperations: WorkspaceToMiroOperations = {
      /**
       * Handle cardStatus request from workspace and route to Miro board
       */
      async cardStatus(boardId, data, callback) {
        debug("Workspace cardStatus request", { data });
        const boardSocket = cardStorage.getBoardSocket(boardId);

        if (!boardSocket) {
          debug("Board not connected", { boardId });
          callback(false);
          return;
        }

        try {
          const card = cardStorage.getCardByLink(data.miroLink);
          invariant(card, "Card not found in storage");
          cardStorage.setCard(data.miroLink, {
            ...card,
            status: data.status,
            codeLink: data.codeLink,
          });

          // Route the cardStatus event to the Miro board
          const success = await boardSocket.emitWithAck(
            "cardStatus",
            boardId,
            data,
          );
          debug("cardStatus routed to board successfully", {
            boardId,
            success,
          });
          callback(success);
        } catch (error) {
          debug("Failed to route cardStatus to board", {
            boardId,
            error,
          });
          callback(false);
        }
      },
      getIdToken: function (
        boardId: string,
        callback: (id: string) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        boardSocket
          .emitWithAck("getIdToken", boardId)
          .then((id) => callback(id as string))
          .catch(() => callback("" as string));
      },
      setBoardName: (
        boardId: string,
        name: string,
        callback: (success: boolean) => void,
      ): void => {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        cardStorage.setBoardName(boardId, name);
        boardSocket
          .emitWithAck("setBoardName", boardId, name)
          .then((success) => callback(success as boolean))
          .catch(() => callback(false));
      },
      getBoardInfo: async function (
        boardId: string,
        callback: (boardInfo: BoardInfo) => void,
      ) {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        try {
          const info = await boardSocket.emitWithAck("getBoardInfo", boardId);

          let boardInfo = cardStorage.getBoard(info.boardId);
          if (!boardInfo) {
            boardInfo = await cardStorage.addBoard(info.boardId, info.name);
          } else if (boardInfo.name !== info.name) {
            cardStorage.setBoardName(info.boardId, info.name);
          }
          debug("boardInfo retrieved", { boardId, info });

          callback(info);
        } catch (_err) {
          callback(undefined as unknown as BoardInfo);
        }
      },
      tags: function (
        boardId: string,
        callback: (tags: AppExplorerTag[]) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        boardSocket
          .emitWithAck("tags", boardId)
          .then((tags) => callback(tags as AppExplorerTag[]))
          .catch(() => callback([]));
      },
      attachCard: function (
        boardId: string,
        data: CardData,
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        boardSocket
          .emitWithAck("attachCard", boardId, data)
          .then((success) => callback(success as boolean))
          .catch(() => callback(false));
      },
      tagCards: function (
        boardId: string,
        data: {
          miroLink: string[];
          tag: string | { color: TagColor; title: string };
        },
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        boardSocket
          .emitWithAck("tagCards", boardId, data)
          .then((success) => callback(success as boolean))
          .catch(() => callback(false));
      },
      selectCard: (
        boardId: string,
        miroLink: string,
        callback: (success: boolean) => void,
      ): void => {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        cardStorage.selectedCards([cardStorage.getCardByLink(miroLink)!]);

        boardSocket
          .emitWithAck("selectCard", boardId, miroLink)
          .then((success) => callback(success as boolean))
          .catch(() => callback(false));
      },
      cards: async (boardId: string, callback: (cards: CardData[]) => void) => {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        try {
          const cards = await boardSocket.emitWithAck("cards", boardId);
          cardStorage.setBoardCards(boardId, cards);

          callback(cards);
        } catch (_err) {
          callback([]);
        }
      },
      selected: async (
        boardId: string,
        callback: (cards: CardData[]) => void,
      ) => {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        try {
          const selected = await boardSocket.emitWithAck("selected", boardId);
          cardStorage.selectedCards(selected);
          callback(selected);
        } catch (_err) {
          callback([]);
        }
      },
      newCards: async (
        boardId: string,
        data: CardData[],
        options: { connect?: string[] },
        callback: (success: boolean) => void,
      ) => {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        try {
          const success = await boardSocket.emitWithAck(
            "newCards",
            boardId,
            data,
            options,
          );

          callback(success);
        } catch (_err) {
          callback(false);
        }
      },
      hoverCard: function (
        boardId: string,
        miroLink: string,
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        boardSocket
          .emitWithAck("hoverCard", boardId, miroLink)
          .then((success) => callback(success as boolean))
          .catch(() => callback(false));
      },
    };

    Object.keys(miroOperations).forEach((k) => {
      const event = k as keyof typeof miroOperations;
      const handler = miroOperations[event];
      socket.on(event, (...args: unknown[]) => {
        debug("Received workspace query", {
          event,
          args,
        });
        // @ts-expect-error This is computing as handler(never), I'm not sure why.
        return handler(...args);
      });
    });

    // Connect server query handlers to socket
    Object.keys(serverQueries).forEach((k) => {
      const event = k as keyof typeof serverQueries;
      const handler = serverQueries[event];
      socket.on(event, (...args: unknown[]) => {
        debug("Received workspace query", {
          event,
          args,
        });
        // @ts-expect-error This is computing as handler(never), I'm not sure why.
        return handler(...args);
      });
    });
  }

  dispose() {
    this.subscriptions.forEach((s) => s.dispose());
    this.httpServer.closeAllConnections();
  }

  async onMiroConnection(socket: MiroServerSocket) {
    try {
      // Add a small delay to allow the client to set up its handlers
      await new Promise((resolve) => setTimeout(resolve, 100));
      socket.onAny((event, ...args) => {
        debugEvents("Received miro event", socket.id, {
          event,
          args,
        });
      });
      socket.onAnyOutgoing((event, ...args) => {
        debugEvents("Sending miro event", socket.id, {
          event,
          args,
        });
      });

      const info = await socket.emitWithAck("getBoardInfo", "");
      debug("Miro board connected", info);

      let boardInfo = this.cardStorage.getBoard(info.boardId);
      if (!boardInfo) {
        boardInfo = await this.cardStorage.addBoard(info.boardId, info.name);
      } else if (boardInfo.name !== info.name) {
        this.cardStorage.setBoardName(info.boardId, info.name);
      }
      debug("boardInfo retrieved", info);

      const cards = await socket.emitWithAck("cards", info.boardId);
      debug("Cards received from Miro board", {
        boardId: info.boardId,
        cardCount: cards.length,
      });
      this.cardStorage.connectBoard(info.boardId, socket);
      this.cardStorage.setBoardCards(info.boardId, cards);

      debug("boardInfo retrieved", info, {
        cards: this.cardStorage.getCardsByBoard()[info.boardId],
      });

      const miroToWorkspace: MiroToWorkspaceOperations = {
        log: ([message, ...args]: unknown[]) => {
          logger.log(message, ...args);
        },
        navigateTo: (card) => {
          // Enhanced logging for navigation events from Miro
          debug("🎯 MIRO EVENT: Navigate to card", {
            timestamp: new Date().toISOString(),
            boardId: info.boardId,
            cardTitle: card.title,
            cardPath: card.path,
            cardSymbol: card.type === "symbol" ? card.symbol : undefined,
            cardMiroLink: card.miroLink,
            cardStatus: card.status,
            eventSource: "miro-board",
            willBroadcastTo: "assigned-workspaces",
          });

          debug("🔄 BROADCASTING TO BOARD WORKSPACES", {
            boardId: card.boardId,
          });

          this.workspaceNamespace.emit("navigateTo", card);
        },
        selectedCards: async (data) => {
          // Broadcast selected cards to all workspaces (no specific board routing needed)
          this.workspaceNamespace.emit("selectedCards", data);
        },
        card: async ({ url, card }) => {
          // Route card update to workspaces assigned to the board
          if (card?.boardId) {
            this.workspaceNamespace.emit("card", {
              url,
              card,
            });
          }
        },
      };
      bindHandlers(
        socket as unknown as ClientSocket<
          MiroToWorkspaceOperations,
          WorkspaceToMiroOperations
        >,
        miroToWorkspace,
      );
    } catch (error) {
      debug("Failed to handle Miro connection", {
        error,
        socketId: socket.id,
      });
    }
  }
}
