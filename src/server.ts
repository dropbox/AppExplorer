import { TagColor } from "@mirohq/websdk-types/stable/features/widgets/tag";
import { createServer } from "http";
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
  ServerToWorkspaceEvents,
  WorkspaceInfo,
  WorkspaceRegistrationRequest,
  WorkspaceRegistrationResponse,
  WorkspaceToMiroOperations,
  WorkspaceToServerOperations,
} from "./EventTypes";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";
import { PortConfig } from "./port-config";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { bindHandlers } from "./utils/bindHandlers";
import { promiseEmit } from "./utils/promise-emit";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import packageJson = require("../package.json");
const logger = createLogger("server");

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
  private connectedWorkspaces = new Map<string, WorkspaceInfo>();

  private cardStorage = new CardStorage(new MemoryAdapter());

  private constructor(
    private featureFlagManager: FeatureFlagManager,
    // Port configuration: Uses PortConfig for centralized port management
    // Defaults to 9042 for production, but can be overridden for E2E testing
    private port: number = PortConfig.getServerPort(),
  ) {
    listenToAllEvents(this.cardStorage, (eventName, ...args) => {
      logger.debug("Server storage event", eventName, ...args);
    });
    const app = express();
    this.httpServer = createServer(app);
    const io = new Server<MiroToWorkspaceOperations, WorkspaceToMiroOperations>(
      this.httpServer,
    );
    io.on("connection", this.onMiroConnection.bind(this));

    // Create workspace namespace
    this.workspaceNamespace = io.of("/workspace");

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
      this.workspaceNamespace.emit("selectedCards", event);
    });

    app.use(compression());
    app.use(
      "/",
      express.static(path.join(__dirname, "../public"), {
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
        connectedBoards: this.cardStorage.getConnectedBoards(),
        cardsByBoard: this.cardStorage.getCardsByBoard(),
      });
    });

    // Server startup is now handled by the startServer() method
    // called from the static create() factory method
  }

  /**
   * Create and start a MiroServer instance with proper error handling
   */
  static async create(
    featureFlagManager: FeatureFlagManager,
    port?: number,
  ): Promise<MiroServer> {
    // Use provided port, or fall back to configured port
    const serverPort = port ?? PortConfig.getServerPort();
    const server = new MiroServer(featureFlagManager, serverPort);
    await server.startServer();
    return server;
  }

  /**
   * Start the HTTP server with proper error handling
   */
  private async startServer(): Promise<void> {
    const port = this.port;

    return new Promise((resolve, reject) => {
      // Set up error handling for port binding failures
      this.httpServer.on("error", (error) => {
        if ("code" in error && error.code === "EADDRINUSE") {
          logger.error("Port already in use", {
            port,
            error: error.message,
          });
          reject(
            new Error(
              `Port ${port} is already in use. Another server instance may be running.`,
            ),
          );
        } else {
          logger.error("Server error", { error });
          reject(error);
        }
      });

      // Start listening on the port
      this.httpServer.listen(port, () => {
        logger.info("Server started successfully", { port });
        vscode.window.showInformationMessage(
          `AppExplorer - Server started. Open a Miro board to connect.`,
        );
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
    logger.info("New workspace connection", { socketId: socket.id });
    socket.onAny((event, ...args) => {
      logger.debug("Received workspace event", socket.id, {
        event,
        args,
      });
    });
    socket.onAnyOutgoing((event, ...args) => {
      logger.debug("Sending workspace event", socket.id, {
        event,
        args,
      });
    });
    socket.on("disconnect", () => {
      logger.warn("Workspace socket disconnected", { id: socket.id });
    });

    const connectedWorkspaces = this.connectedWorkspaces;
    const cardStorage = this.cardStorage;

    cardStorage
      .on("connectedBoards", (event) => {
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
        socket.emit("selectedCards", event);
      });

    const serverQueries: WorkspaceToServerOperations = {
      /**
       * Handle workspace registration request
       */
      workspaceRegistration: (
        request: WorkspaceRegistrationRequest,
        callback: (response: WorkspaceRegistrationResponse) => void,
      ): void => {
        logger.info("Workspace registration request", request);

        try {
          // Create workspace info
          const workspaceInfo: WorkspaceInfo = {
            id: request.workspaceId,
            socket,
          };

          // Store workspace connection
          connectedWorkspaces.set(request.workspaceId, workspaceInfo);

          // Join the workspace room so the client can receive events sent to this workspace
          // socket.join(request.workspaceId);
          logger.debug("Workspace client", {
            workspaceId: request.workspaceId,
            socketId: socket.id,
          });

          // Send successful registration response
          const response: WorkspaceRegistrationResponse = {
            success: true,
            workspaceId: request.workspaceId,
            cardsByBoard: this.cardStorage.getCardsByBoard(),
          };

          logger.info("Workspace registered successfully", {
            workspaceId: request.workspaceId,
          });
          callback(response);
        } catch (error) {
          logger.error("Workspace registration failed", {
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
        logger.info("Workspace cardStatus request", { data });
        const boardSocket = cardStorage.getBoardSocket(boardId);

        if (!boardSocket) {
          logger.error("Board not connected", { boardId });
          callback(false);
          return;
        }

        try {
          // Route the cardStatus event to the Miro board
          const success = await promiseEmit(
            boardSocket,
            "cardStatus",
            boardId,
            data,
          );
          logger.info("cardStatus routed to board successfully", {
            boardId,
            success,
          });
          callback(success);
        } catch (error) {
          logger.error("Failed to route cardStatus to board", {
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
        promiseEmit(boardSocket, "getIdToken", boardId).then(callback);
      },
      setBoardName: function (
        boardId: string,
        name: string,
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "setBoardName", boardId, name).then(callback);
      },
      getBoardInfo: function (
        boardId: string,
        callback: (boardInfo: BoardInfo) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "getBoardInfo", boardId).then(callback);
      },
      tags: function (
        boardId: string,
        callback: (tags: AppExplorerTag[]) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "tags", boardId).then(callback);
      },
      attachCard: function (
        boardId: string,
        data: CardData,
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "attachCard", boardId, data).then(callback);
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
        promiseEmit(boardSocket, "tagCards", boardId, data).then(callback);
      },
      selectCard: function (
        boardId: string,
        miroLink: string,
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "selectCard", boardId, miroLink).then(
          callback,
        );
      },
      cards: function (
        boardId: string,
        callback: (cards: CardData[]) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "cards", boardId).then(callback);
      },
      selected: function (
        boardId: string,
        callback: (cards: CardData[]) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "selected", boardId).then(callback);
      },
      newCards: function (
        boardId: string,
        data: CardData[],
        options: { connect?: string[] },
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "newCards", boardId, data, options).then(
          callback,
        );
      },
      hoverCard: function (
        boardId: string,
        miroLink: string,
        callback: (success: boolean) => void,
      ): void {
        const boardSocket = cardStorage.getBoardSocket(boardId);
        invariant(boardSocket, "Board not connected");
        promiseEmit(boardSocket, "hoverCard", boardId, miroLink).then(callback);
      },
    };

    Object.keys(miroOperations).forEach((k) => {
      const event = k as keyof typeof miroOperations;
      const handler = miroOperations[event];
      socket.on(event, (...args: unknown[]) => {
        logger.debug("Received workspace query", {
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
        logger.debug("Received workspace query", {
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
        logger.debug("Received miro event", socket.id, {
          event,
          args,
        });
      });
      socket.onAnyOutgoing((event, ...args) => {
        logger.debug("Sending miro event", socket.id, {
          event,
          args,
        });
      });

      const info = await promiseEmit(socket, "getBoardInfo", "");
      logger.info("Miro board connected", info);

      let boardInfo = this.cardStorage.getBoard(info.boardId);
      if (!boardInfo) {
        boardInfo = await this.cardStorage.addBoard(info.boardId, info.name);
      } else if (boardInfo.name !== info.name) {
        this.cardStorage.setBoardName(info.boardId, info.name);
      }

      const cards = await promiseEmit(socket, "cards", info.boardId);
      logger.info("Cards received from Miro board", {
        boardId: info.boardId,
        cardCount: cards.length,
      });
      this.cardStorage.connectBoard(info.boardId, socket);
      this.cardStorage.setBoardCards(info.boardId, cards);

      const miroToWorkspace: MiroToWorkspaceOperations = {
        navigateTo: (card) => {
          // Enhanced logging for navigation events from Miro
          logger.info("🎯 MIRO EVENT: Navigate to card", {
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

          logger.debug("🔄 BROADCASTING TO BOARD WORKSPACES", {
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
      logger.error("Failed to handle Miro connection", {
        error,
        socketId: socket.id,
      });
    }
  }
}
