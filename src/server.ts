import { createServer } from "http";
import * as path from "path";
import type { Socket } from "socket.io";
import { Server } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import {
  CardData,
  Queries,
  RequestEvents,
  ResponseEvents,
  ServerCapabilities,
  WorkspaceInfo,
  WorkspaceRegistrationRequest,
  WorkspaceRegistrationResponse,
} from "./EventTypes";
import { HandlerContext } from "./extension";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";
import { ServerCardStorage } from "./server-card-storage";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import packageJson = require("../package.json");

type MiroEvents =
  | {
      type: "connect";
      boardInfo: { id: string; name: string };
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
  httpServer: ReturnType<typeof createServer>;
  private workspaceNamespace?: any; // Socket.IO namespace for workspace connections
  private connectedWorkspaces = new Map<string, WorkspaceInfo>();
  private serverCardStorage?: ServerCardStorage; // Server-side memory-backed storage
  private logger = createLogger("miro-server");

  private constructor(
    private context: HandlerContext,
    private featureFlagManager?: FeatureFlagManager,
  ) {
    super();

    const app = express();
    this.httpServer = createServer(app);
    const io = new Server<ResponseEvents, RequestEvents>(this.httpServer);
    io.on("connection", this.onConnection.bind(this));

    // Initialize workspace websocket server if enabled
    if (this.featureFlagManager?.isEnabled("enableWorkspaceWebsockets")) {
      this.initializeWorkspaceWebsockets(io);
    }

    // Initialize server-side card storage if dual storage is enabled
    if (this.featureFlagManager?.isEnabled("enableDualStorage")) {
      this.initializeServerCardStorage();
    }

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

    // Add server capabilities endpoint
    app.get("/capabilities", (_req, res) => {
      const capabilities: ServerCapabilities = {
        supportedFeatures: this.getSupportedFeatures(),
        migrationPhase: 1,
        serverVersion: packageJson.version,
      };
      res.json(capabilities);
    });

    // Add server storage statistics endpoint
    app.get("/storage-stats", (_req, res) => {
      const stats = this.getServerStorageStats();
      res.json(stats);
    });

    // Server startup is now handled by the startServer() method
    // called from the static create() factory method
  }

  /**
   * Create and start a MiroServer instance with proper error handling
   */
  static async create(
    context: HandlerContext,
    featureFlagManager?: FeatureFlagManager,
  ): Promise<MiroServer> {
    const server = new MiroServer(context, featureFlagManager);
    await server.startServer();
    return server;
  }

  /**
   * Start the HTTP server with proper error handling
   */
  private async startServer(): Promise<void> {
    const port = 9042;

    return new Promise((resolve, reject) => {
      // Set up error handling for port binding failures
      this.httpServer.on("error", (error: any) => {
        if (error.code === "EADDRINUSE") {
          this.logger.error("Port already in use", {
            port,
            error: error.message,
          });
          reject(
            new Error(
              `Port ${port} is already in use. Another server instance may be running.`,
            ),
          );
        } else {
          this.logger.error("Server error", { error });
          reject(error);
        }
      });

      // Start listening on the port
      this.httpServer.listen(port, () => {
        this.logger.info("Server started successfully", { port });
        vscode.window.showInformationMessage(
          `AppExplorer - Server started. Open a Miro board to connect.`,
        );
        resolve();
      });
    });
  }

  /**
   * Initialize workspace websocket server on /workspace namespace
   */
  private initializeWorkspaceWebsockets(
    io: Server<ResponseEvents, RequestEvents>,
  ): void {
    this.logger.info("Initializing workspace websocket server");

    // Create workspace namespace
    this.workspaceNamespace = io.of("/workspace");

    // Handle workspace connections
    this.workspaceNamespace.on("connection", (socket: any) => {
      this.onWorkspaceConnection(socket);
    });

    this.logger.debug(
      "Workspace websocket server initialized on /workspace namespace",
    );
  }

  /**
   * Initialize server-side card storage
   */
  private initializeServerCardStorage(): void {
    if (!this.featureFlagManager) {
      return;
    }

    this.logger.info("Initializing server-side card storage");
    this.serverCardStorage = new ServerCardStorage(this.featureFlagManager);

    // Set up event listeners for server card storage events
    this.serverCardStorage.on("boardUpdate", (event) => {
      this.logger.debug("Server storage board update", {
        boardId: event.boardId,
        boardName: event.board?.name,
      });

      // Broadcast board update to connected workspaces
      this.broadcastToWorkspaces("boardUpdate", {
        type: "boardUpdate",
        boardId: event.boardId,
        board: event.board,
      });
    });

    this.serverCardStorage.on("cardUpdate", (event) => {
      this.logger.debug("Server storage card update", {
        boardId: event.boardId,
        miroLink: event.miroLink,
        cardTitle: event.card?.title,
      });

      // Broadcast card update to connected workspaces
      this.broadcastToWorkspaces("cardUpdate", {
        type: "cardUpdate",
        boardId: event.boardId,
        card: event.card,
        miroLink: event.miroLink,
      });
    });

    this.serverCardStorage.on("connectedBoards", (event) => {
      this.logger.debug("Server storage connected boards changed", {
        boards: event.boards,
      });

      // Broadcast connection status to connected workspaces
      this.broadcastToWorkspaces("connectionStatus", {
        type: "connectionStatus",
        connectedBoards: event.boards,
      });
    });

    this.logger.debug("Server-side card storage initialized");
  }

  /**
   * Broadcast event to all connected workspace clients
   */
  private broadcastToWorkspaces(eventType: string, data: any): void {
    if (!this.workspaceNamespace) {
      this.logger.debug("No workspace namespace available for broadcasting");
      return;
    }

    this.logger.debug("Broadcasting to workspace clients", {
      eventType,
      connectedClients: this.connectedWorkspaces.size,
    });

    // Broadcast to all connected workspace clients
    this.workspaceNamespace.emit(eventType, data);
  }

  /**
   * Broadcast event to specific workspace clients by board assignment
   */
  private broadcastToBoardWorkspaces(
    boardId: string,
    eventType: string,
    data: any,
  ): void {
    if (!this.workspaceNamespace) {
      return;
    }

    // Find workspaces assigned to this board
    const assignedWorkspaces = Array.from(
      this.connectedWorkspaces.values(),
    ).filter((workspace) => workspace.boardIds.includes(boardId));

    if (assignedWorkspaces.length === 0) {
      // If no specific assignments, broadcast to all workspaces
      this.broadcastToWorkspaces(eventType, data);
      return;
    }

    this.logger.debug("Broadcasting to board-specific workspaces", {
      boardId,
      eventType,
      workspaceCount: assignedWorkspaces.length,
    });

    // For now, broadcast to all since we don't track individual socket connections
    // TODO: In future, maintain socket ID mapping for targeted broadcasts
    this.workspaceNamespace.emit(eventType, data);
  }

  /**
   * Handle new workspace websocket connection
   */
  private async onWorkspaceConnection(socket: any): Promise<void> {
    this.logger.info("New workspace connection", { socketId: socket.id });

    // Handle workspace registration
    socket.on(
      "workspaceRegistration",
      async (request: WorkspaceRegistrationRequest) => {
        await this.handleWorkspaceRegistration(socket, request);
      },
    );

    // Handle ping/pong for health monitoring
    socket.on("ping", (data: { timestamp: number }) => {
      socket.emit("pong", { timestamp: data.timestamp });
    });

    // Handle workspace disconnection
    socket.on("disconnect", (reason: string) => {
      this.handleWorkspaceDisconnection(socket, reason);
    });

    // Send server capabilities to new workspace
    const capabilities: ServerCapabilities = {
      supportedFeatures: this.getSupportedFeatures(),
      migrationPhase: 1, // Currently in Phase 1
      serverVersion: packageJson.version,
    };

    socket.emit("serverCapabilities", { capabilities });
  }

  /**
   * Handle workspace registration request
   */
  private async handleWorkspaceRegistration(
    socket: any,
    request: WorkspaceRegistrationRequest,
  ): Promise<void> {
    this.logger.info("Workspace registration request", {
      workspaceId: request.workspaceId,
      boardIds: request.boardIds,
    });

    try {
      // Create workspace info
      const workspaceInfo: WorkspaceInfo = {
        id: request.workspaceId,
        name: request.workspaceName,
        rootPath: request.rootPath,
        connectedAt: new Date(),
        lastActivity: new Date(),
        boardIds: request.boardIds,
      };

      // Store workspace connection
      this.connectedWorkspaces.set(request.workspaceId, workspaceInfo);

      // Send successful registration response
      const response: WorkspaceRegistrationResponse = {
        success: true,
        workspaceId: request.workspaceId,
        serverCapabilities: {
          supportedFeatures: this.getSupportedFeatures(),
          migrationPhase: 1,
          serverVersion: packageJson.version,
        },
        assignedBoards: request.boardIds, // For now, assign all requested boards
      };

      socket.emit("workspaceRegistrationResponse", response);
      this.logger.info("Workspace registered successfully", {
        workspaceId: request.workspaceId,
      });
    } catch (error) {
      this.logger.error("Workspace registration failed", {
        workspaceId: request.workspaceId,
        error,
      });

      const response: WorkspaceRegistrationResponse = {
        success: false,
        workspaceId: request.workspaceId,
        serverCapabilities: {
          supportedFeatures: [],
          migrationPhase: 1,
          serverVersion: packageJson.version,
        },
        assignedBoards: [],
        error: String(error),
      };

      socket.emit("workspaceRegistrationResponse", response);
    }
  }

  /**
   * Handle workspace disconnection
   */
  private handleWorkspaceDisconnection(socket: any, reason: string): void {
    // Find and remove workspace by socket
    for (const [workspaceId, workspace] of this.connectedWorkspaces.entries()) {
      // Note: In a real implementation, we'd need to track socket IDs
      // For now, we'll just log the disconnection
      this.logger.info("Workspace disconnected", {
        socketId: socket.id,
        reason,
      });
      break;
    }
  }

  /**
   * Get list of supported features based on feature flags
   */
  private getSupportedFeatures(): string[] {
    const features: string[] = [];

    if (this.featureFlagManager?.isEnabled("enableServerDiscovery")) {
      features.push("serverDiscovery");
    }

    if (this.featureFlagManager?.isEnabled("enableWorkspaceWebsockets")) {
      features.push("workspaceWebsockets");
    }

    if (this.featureFlagManager?.isEnabled("enableDualStorage")) {
      features.push("dualStorage");
    }

    if (this.featureFlagManager?.isEnabled("enableServerFailover")) {
      features.push("serverFailover");
    }

    if (this.featureFlagManager?.isEnabled("enableQueryProxying")) {
      features.push("queryProxying");
    }

    if (this.featureFlagManager?.isEnabled("enableServerEventRouting")) {
      features.push("serverEventRouting");
    }

    if (this.featureFlagManager?.isEnabled("enableWebsocketStatusBar")) {
      features.push("websocketStatusBar");
    }

    return features;
  }

  /**
   * Get server-side card storage (if enabled)
   */
  getServerCardStorage(): ServerCardStorage | undefined {
    return this.serverCardStorage;
  }

  /**
   * Get server storage statistics
   */
  getServerStorageStats() {
    return (
      this.serverCardStorage?.getStats() || {
        boardCount: 0,
        cardCount: 0,
        connectedBoardCount: 0,
        isEnabled: false,
      }
    );
  }

  destroy() {
    this.subscriptions.forEach((s) => s.dispose());

    // Clean up server card storage
    if (this.serverCardStorage) {
      this.serverCardStorage.dispose();
    }

    this.httpServer.closeAllConnections();
  }

  async onConnection(
    socket: Socket<ResponseEvents, RequestEvents, DefaultEventsMap, any>,
  ) {
    const { context } = this;
    const info = await querySocket(socket, "getBoardInfo");
    const boardId = info.boardId;

    // Connect to workspace card storage (always)
    context.cardStorage.connectBoard(boardId, socket);

    // Also connect to server card storage if dual storage is enabled
    if (this.serverCardStorage) {
      await this.serverCardStorage.connectBoard(boardId, socket);
    }
    socket.once("disconnect", () => {
      this.fire({ type: "disconnect" });

      // Broadcast board disconnection to workspace clients
      this.broadcastToWorkspaces("boardDisconnected", {
        type: "boardDisconnected",
        boardId,
      });
    });
    socket.on("navigateTo", async (card) =>
      this.fire({ type: "navigateToCard", card }),
    );
    socket.on("card", async ({ url, card }) => {
      this.fire({ type: "updateCard", miroLink: url, card });

      // Also update server card storage if dual storage is enabled
      if (this.serverCardStorage && card) {
        await this.serverCardStorage.setCard(boardId, card);
      } else if (this.serverCardStorage && !card) {
        // Card deletion
        this.serverCardStorage.deleteCardByLink(url);
      }
    });

    let boardInfo = context.cardStorage.getBoard(boardId);
    if (!boardInfo) {
      boardInfo = await context.cardStorage.addBoard(boardId, info.name);

      // Also add to server storage if dual storage is enabled
      if (this.serverCardStorage) {
        await this.serverCardStorage.addBoard(boardId, info.name);
      }
    } else if (boardInfo.name !== info.name) {
      context.cardStorage.setBoardName(boardId, info.name);
      boardInfo = { ...boardInfo, name: info.name };

      // Also update server storage if dual storage is enabled
      if (this.serverCardStorage) {
        this.serverCardStorage.setBoardName(boardId, info.name);
      }
    }

    const cards = await querySocket(socket, "cards");
    context.cardStorage.setBoardCards(boardId, cards);

    // Also set cards in server storage if dual storage is enabled
    if (this.serverCardStorage) {
      this.serverCardStorage.setBoardCards(boardId, cards);
    }

    this.fire({ type: "connect", boardInfo });

    // Broadcast board connection to workspace clients
    this.broadcastToWorkspaces("boardConnected", {
      type: "boardConnected",
      boardInfo: {
        id: boardInfo.id,
        name: boardInfo.name,
      },
    });
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
