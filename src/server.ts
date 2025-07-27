import { createServer } from "http";
import * as path from "path";
import { Namespace, Server, Socket as ServerSocket } from "socket.io";
import * as vscode from "vscode";
import { CardStorage, MemoryAdapter } from "./card-storage";
import {
  MiroToWorkspaceEvents,
  OperationEventType,
  QueryFunction,
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
import { querySocket } from "./utils/querySocket";
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
  MiroToWorkspaceEvents,
  QueryFunction<WorkspaceToMiroOperations>
>;

export type WorkspaceServerSocket = ServerSocket<
  QueryFunction<WorkspaceToMiroOperations & WorkspaceToServerOperations>,
  MiroToWorkspaceEvents & ServerToWorkspaceEvents
>;

export class MiroServer {
  subscriptions = [] as vscode.Disposable[];
  httpServer: ReturnType<typeof createServer>;
  private workspaceNamespace: Namespace<
    MiroToWorkspaceEvents,
    MiroToWorkspaceEvents
  >;
  private connectedWorkspaces = new Map<string, WorkspaceInfo>();

  private cardStorage = new CardStorage(new MemoryAdapter());

  private constructor(
    private featureFlagManager: FeatureFlagManager,
    // Port configuration: Uses PortConfig for centralized port management
    // Defaults to 9042 for production, but can be overridden for E2E testing
    private port: number = PortConfig.getServerPort(),
  ) {
    const app = express();
    this.httpServer = createServer(app);
    const io = new Server<
      MiroToWorkspaceEvents,
      QueryFunction<WorkspaceToMiroOperations>
    >(this.httpServer);
    io.on("connection", this.onMiroConnection.bind(this));

    // Create workspace namespace
    this.workspaceNamespace = io.of("/workspace");

    // Handle workspace connections
    this.workspaceNamespace.on("connection", (socket) => {
      this.onWorkspaceConnection(socket);
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
   * Handle query proxy request from workspace client
   */
  private async handleQueryProxyRequest(
    _socket: ServerSocket<
      QueryFunction<WorkspaceToMiroOperations>,
      MiroToWorkspaceEvents
    >,
    _request: OperationEventType<WorkspaceToMiroOperations>,
  ): Promise<void> {}

  /**
   * Broadcast event to all connected workspace clients
   */
  private broadcastToWorkspaces<K extends keyof MiroToWorkspaceEvents>(
    eventType: K,
    ...args: Parameters<MiroToWorkspaceEvents[K]>
  ): void {
    if (!this.workspaceNamespace) {
      logger.debug("No workspace namespace available for broadcasting");
      return;
    }

    logger.debug("Broadcasting to workspace clients", {
      eventType,
      connectedClients: this.connectedWorkspaces.size,
    });

    // Broadcast to all connected workspace clients
    this.workspaceNamespace.emit(eventType, ...args);
  }

  /**
   * Broadcast event to specific workspace clients by board assignment
   */
  private broadcastToBoardWorkspaces<K extends keyof MiroToWorkspaceEvents>(
    boardId: string,
    eventType: K,
    ...args: Parameters<MiroToWorkspaceEvents[K]>
  ): void {
    // Enhanced logging for event routing decisions
    logger.info("🎯 EVENT ROUTING: Board-specific broadcast", {
      timestamp: new Date().toISOString(),
      boardId,
      eventType,
      direction: "server->clients",
      argsCount: args.length,
      hasWorkspaceNamespace: !!this.workspaceNamespace,
    });

    if (!this.workspaceNamespace) {
      logger.warn("❌ Cannot broadcast - no workspace namespace", {
        timestamp: new Date().toISOString(),
        boardId,
        eventType,
      });
      return;
    }

    logger.debug("Event broadcast completed", {
      timestamp: new Date().toISOString(),
      boardId,
      eventType,
      totalConnectedWorkspaces: this.connectedWorkspaces.size,
    });
  }

  /**
   * Handle workspace websocket connection
   */
  private async onWorkspaceConnection(
    socket: WorkspaceServerSocket,
  ): Promise<void> {
    logger.info("New workspace connection", { socketId: socket.id });

    const connectedWorkspaces = this.connectedWorkspaces;

    const serverQueries: WorkspaceToServerOperations = {
      /**
       * Handle workspace registration request
       */
      async workspaceRegistration(
        request: WorkspaceRegistrationRequest,
      ): Promise<WorkspaceRegistrationResponse> {
        logger.info("Workspace registration request", {
          workspaceId: request.workspaceId,
          boardIds: request.boardIds,
        });

        try {
          // Create workspace info
          const workspaceInfo: WorkspaceInfo = {
            id: request.workspaceId,
            socket,
          };

          // Store workspace connection
          connectedWorkspaces.set(request.workspaceId, workspaceInfo);

          // Join the workspace room so the client can receive events sent to this workspace
          socket.join(request.workspaceId);
          logger.debug("Workspace client joined room", {
            workspaceId: request.workspaceId,
            socketId: socket.id,
          });

          // Send successful registration response
          const response: WorkspaceRegistrationResponse = {
            success: true,
            workspaceId: request.workspaceId,
            assignedBoards: request.boardIds, // For now, assign all requested boards
          };

          logger.info("Workspace registered successfully", {
            workspaceId: request.workspaceId,
          });
          return response;
        } catch (error) {
          logger.error("Workspace registration failed", {
            workspaceId: request.workspaceId,
            error,
          });

          const response: WorkspaceRegistrationResponse = {
            success: false,
            workspaceId: request.workspaceId,
            assignedBoards: [],
            error: String(error),
          };
          return response;
        }
      },
    };

    // Handle query proxy requests
    socket.on("query", async (operationEvent) => {
      logger.debug("Received query from workspace client", {
        workspaceId: socket.id,
        query: operationEvent.query,
        data: operationEvent.data,
      });

      // Type guard to check if this is a workspace-to-server operation
      const isWorkspaceToServerOperation = (
        query: string,
      ): query is keyof WorkspaceToServerOperations => {
        return query === "workspaceRegistration";
      };

      if (isWorkspaceToServerOperation(operationEvent.query)) {
        // Handle workspace-to-server operations
        switch (operationEvent.query) {
          case "workspaceRegistration": {
            // For workspace registration, data[0] contains the registration request
            // Type assertion is necessary due to dynamic query parameter structure
            const registrationRequest = operationEvent
              .data[0] as WorkspaceRegistrationRequest;
            const response =
              await serverQueries.workspaceRegistration(registrationRequest);
            socket.emit("registrationComplete", response);
            break;
          }
          default:
            throw new UnreachableError(operationEvent.query);
        }
      } else {
        // Handle workspace-to-miro operations
        // TypeScript now knows this is a WorkspaceToMiroOperations query
        const miroOperationEvent =
          operationEvent as OperationEventType<WorkspaceToMiroOperations>;

        try {
          // For other queries, forward to Miro boards via query proxy
          const response = (await this.handleQueryProxyRequest(
            socket,
            miroOperationEvent,
            // Assume its going to return a matching type for the request
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          )) as any;
          logger.debug("Proxied result", {
            workspaceId: socket.id,
            requestId: miroOperationEvent.requestId,
            query: miroOperationEvent.query,
            response,
          });
          socket.emit("queryResult", {
            name: miroOperationEvent.query,
            requestId: miroOperationEvent.requestId,
            response,
          });
        } catch (error) {
          socket.emit("queryResult", {
            name: miroOperationEvent.query,
            requestId: miroOperationEvent.requestId,
            error: String(error),
          });
        }
      }
    });

    // Handle workspace disconnection
    socket.on("disconnect", (reason: string) => {
      this.handleWorkspaceDisconnectionBySocket(socket, reason);
    });
  }

  /**
   * Handle workspace disconnection by socket
   */
  private handleWorkspaceDisconnectionBySocket(
    _socket: any,
    _reason: string,
  ): void {}

  dispose() {
    this.subscriptions.forEach((s) => s.dispose());
    this.httpServer.closeAllConnections();
  }

  async onMiroConnection(socket: MiroServerSocket) {
    const { cardStorage } = this;
    const info = await querySocket(socket, "", "getBoardInfo");
    const boardId = info.boardId;

    // Connect to workspace card storage (always)
    cardStorage.connectBoard(boardId, socket);

    socket.once("disconnect", () => {
      // Broadcast board disconnection to workspace clients
    });
    const handlers: MiroToWorkspaceEvents = {
      navigateTo: async (card) => {
        // Enhanced logging for navigation events from Miro
        logger.info("🎯 MIRO EVENT: Navigate to card", {
          timestamp: new Date().toISOString(),
          boardId,
          cardTitle: card.title,
          cardPath: card.path,
          cardSymbol: card.type === "symbol" ? card.symbol : undefined,
          cardMiroLink: card.miroLink,
          cardStatus: card.status,
          eventSource: "miro-board",
          willBroadcastTo: "assigned-workspaces",
        });

        this.broadcastToBoardWorkspaces(card.boardId, "navigateTo", card);
      },
      selectedCards: async (data) => {
        // Broadcast selected cards to all workspaces (no specific board routing needed)
        this.broadcastToWorkspaces("selectedCards", data);
      },
      card: async ({ url, card }) => {
        // Route card update to workspaces assigned to the board
        if (card?.boardId) {
          this.broadcastToBoardWorkspaces(card.boardId, "card", { url, card });
        }
      },
      cardsInEditor: function (_data) {
        throw new Error("Function not implemented.");
      },
      queryResult(_data) {
        throw new Error("Function not implemented.");
      },
      connectionStatus(_data): void {
        throw new Error("Function not implemented.");
      },
      healthCheck(_data): void {
        throw new Error("Function not implemented.");
      },
    };
    Object.keys(handlers).forEach((k) => {
      const event = k as keyof typeof handlers;
      const handler = handlers[event];
      socket.on(event, (...args: any[]) => {
        logger.debug("Received event from Miro board", {
          boardId,
          event,
          args,
        });
        // @ts-expect-error This is computing as handler(never), I'm not sure why.
        return handler(...args);
      });
    });

    let boardInfo = cardStorage.getBoard(boardId);
    if (!boardInfo) {
      boardInfo = await cardStorage.addBoard(boardId, info.name);
    } else if (boardInfo.name !== info.name) {
      cardStorage.setBoardName(boardId, info.name);
    }

    const cards = await querySocket(socket, boardId, "cards");
    cardStorage.setBoardCards(boardId, cards);
  }
}
