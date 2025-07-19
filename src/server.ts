import { createServer } from "http";
import * as path from "path";
import type { Socket } from "socket.io";
import { Server } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import {
  BoardAssignmentConfig,
  CardData,
  DEFAULT_BOARD_ASSIGNMENT_CONFIG,
  DEFAULT_BOARD_PERMISSIONS,
  DEFAULT_QUERY_PROXY_CONFIG,
  Queries,
  QueryProxyConfig,
  QueryProxyRequest,
  RequestEvents,
  ResponseEvents,
  ServerCapabilities,
  WorkspaceBoardAssignment,
  WorkspaceConnectionStatus,
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
  private queryProxyConfig: QueryProxyConfig;
  private pendingQueries = new Map<string, QueryProxyRequest>(); // requestId -> request
  private queryTimeouts = new Map<string, NodeJS.Timeout>(); // requestId -> timeout
  private boardAssignmentConfig: BoardAssignmentConfig;
  private workspaceBoardAssignments = new Map<
    string,
    WorkspaceBoardAssignment
  >(); // workspaceId -> assignment
  private boardWorkspaceMap = new Map<string, Set<string>>(); // boardId -> Set<workspaceId>
  private healthCheckInterval?: NodeJS.Timeout; // Health check timer
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly STALE_CONNECTION_TIMEOUT = 60000; // 60 seconds
  private logger = createLogger("miro-server");

  /**
   * Override fire method to add comprehensive logging and workspace broadcasting
   */
  fire(event: MiroEvents): void {
    // Enhanced logging for all MiroServer events
    this.logger.info("🔥 MIRO SERVER EVENT: Firing event", {
      timestamp: new Date().toISOString(),
      eventType: event.type,
      eventData:
        event.type === "navigateToCard"
          ? {
              cardTitle: event.card.title,
              cardPath: event.card.path,
              cardBoardId: event.card.boardId,
              cardMiroLink: event.card.miroLink,
            }
          : event.type === "updateCard"
            ? {
                miroLink: event.miroLink,
                hasCard: !!event.card,
                cardTitle: event.card?.title,
              }
            : event.type === "connect"
              ? {
                  boardId: event.boardInfo.id,
                  boardName: event.boardInfo.name,
                }
              : {},
    });

    // Call the parent fire method to emit the event
    super.fire(event);

    // Also broadcast to workspace clients based on event type
    this.broadcastEventToWorkspaces(event);
  }

  /**
   * Broadcast MiroServer events to appropriate workspace clients
   */
  private broadcastEventToWorkspaces(event: MiroEvents): void {
    switch (event.type) {
      case "navigateToCard":
        this.logger.info("🎯 Broadcasting navigateToCard to workspaces", {
          timestamp: new Date().toISOString(),
          cardBoardId: event.card.boardId,
          cardTitle: event.card.title,
        });
        this.broadcastToBoardWorkspaces(event.card.boardId, "navigateToCard", {
          card: event.card,
        });
        break;

      case "updateCard":
        this.logger.debug("🔄 Broadcasting updateCard to workspaces", {
          timestamp: new Date().toISOString(),
          miroLink: event.miroLink,
          hasCard: !!event.card,
        });
        // For updateCard, we need to determine the boardId from the card or miroLink
        if (event.card?.boardId) {
          this.broadcastToBoardWorkspaces(event.card.boardId, "updateCard", {
            miroLink: event.miroLink,
            card: event.card,
          });
        }
        break;

      case "connect":
        this.logger.info("🔗 Broadcasting connect to workspaces", {
          timestamp: new Date().toISOString(),
          boardId: event.boardInfo.id,
          boardName: event.boardInfo.name,
        });
        this.broadcastToBoardWorkspaces(event.boardInfo.id, "connect", {
          boardInfo: event.boardInfo,
        });
        break;

      case "disconnect":
        this.logger.info("🔌 Broadcasting disconnect to all workspaces", {
          timestamp: new Date().toISOString(),
        });
        this.broadcastToWorkspaces("disconnect", {});
        break;
    }
  }

  private constructor(
    private context: HandlerContext,
    private featureFlagManager?: FeatureFlagManager,
  ) {
    super();

    // Initialize query proxy configuration
    this.queryProxyConfig = DEFAULT_QUERY_PROXY_CONFIG;

    // Initialize board assignment configuration
    this.boardAssignmentConfig = DEFAULT_BOARD_ASSIGNMENT_CONFIG;

    this.logger.debug("MiroServer initialized with board assignment", {
      autoAssignNewBoards: this.boardAssignmentConfig.autoAssignNewBoards,
      requireExplicitAssignment:
        this.boardAssignmentConfig.requireExplicitAssignment,
      maxBoardsPerWorkspace: this.boardAssignmentConfig.maxBoardsPerWorkspace,
    });

    const app = express();
    this.httpServer = createServer(app);
    const io = new Server<ResponseEvents, RequestEvents>(this.httpServer);
    io.on("connection", this.onConnection.bind(this));

    // Initialize workspace websocket server if enabled
    if (this.featureFlagManager?.isEnabled("enableWorkspaceWebsockets")) {
      this.initializeWorkspaceWebsockets(io);
      this.startHealthCheckSystem();
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

      // Broadcast board update to workspaces assigned to this board
      this.broadcastToBoardWorkspaces(event.boardId, "boardUpdate", {
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

      // Broadcast card update to workspaces assigned to this board
      this.broadcastToBoardWorkspaces(event.boardId, "cardUpdate", {
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

      // Broadcast connection status to all connected workspaces (not board-specific)
      this.broadcastToWorkspaces("connectionStatus", {
        type: "connectionStatus",
        connectedBoards: event.boards,
      });
    });

    this.logger.debug("Server-side card storage initialized");
  }

  /**
   * Handle query proxy request from workspace client
   */
  private async handleQueryProxyRequest(
    socket: any,
    request: {
      type: "queryRequest";
      requestId: string;
      boardId: string;
      query: keyof Queries;
      data: any[];
      timeout?: number;
    },
  ): Promise<void> {
    if (!this.featureFlagManager?.isEnabled("enableQueryProxying")) {
      this.logger.debug("Query proxying disabled, rejecting request", {
        requestId: request.requestId,
        query: request.query,
        boardId: request.boardId,
      });

      socket.emit("queryResponse", {
        type: "queryResponse",
        requestId: request.requestId,
        error: "Query proxying is disabled",
      });
      return;
    }

    const startTime = Date.now();
    const timeout = request.timeout || this.queryProxyConfig.timeout;

    // Find workspace info for this socket
    const workspaceId = this.findWorkspaceIdBySocket(socket);
    if (!workspaceId) {
      this.logger.warn("Query proxy request from unregistered workspace", {
        requestId: request.requestId,
        socketId: socket.id,
      });

      socket.emit("queryResponse", {
        type: "queryResponse",
        requestId: request.requestId,
        error: "Workspace not registered",
      });
      return;
    }

    // Check board access
    if (!this.checkBoardAccess(workspaceId, request.boardId)) {
      this.logger.warn("Query proxy request denied - no board access", {
        requestId: request.requestId,
        workspaceId,
        boardId: request.boardId,
        query: request.query,
      });

      socket.emit("queryResponse", {
        type: "queryResponse",
        requestId: request.requestId,
        error: "Access denied to board",
      });
      return;
    }

    this.logger.info("Processing query proxy request", {
      requestId: request.requestId,
      workspaceId,
      boardId: request.boardId,
      query: request.query,
      timeout,
    });

    // Create query proxy request tracking
    const proxyRequest: QueryProxyRequest = {
      requestId: request.requestId,
      boardId: request.boardId,
      query: request.query,
      data: request.data,
      timestamp: startTime,
      timeout,
      workspaceId,
      attempt: 1,
      maxAttempts: this.queryProxyConfig.maxRetries,
    };

    this.pendingQueries.set(request.requestId, proxyRequest);

    try {
      // Forward query to Miro board
      const result = await this.forwardQueryToBoard(proxyRequest);
      const duration = Date.now() - startTime;

      this.logger.info("Query proxy request successful", {
        requestId: request.requestId,
        workspaceId,
        boardId: request.boardId,
        query: request.query,
        duration: `${duration}ms`,
      });

      // Send successful response back to workspace
      socket.emit("queryResponse", {
        type: "queryResponse",
        requestId: request.requestId,
        result,
        duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error("Query proxy request failed", {
        requestId: request.requestId,
        workspaceId,
        boardId: request.boardId,
        query: request.query,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
      });

      // Send error response back to workspace
      socket.emit("queryResponse", {
        type: "queryResponse",
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });
    } finally {
      // Clean up tracking
      this.pendingQueries.delete(request.requestId);
      const timeoutHandle = this.queryTimeouts.get(request.requestId);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        this.queryTimeouts.delete(request.requestId);
      }
    }
  }

  /**
   * Forward query to the appropriate Miro board
   */
  private async forwardQueryToBoard(request: QueryProxyRequest): Promise<any> {
    // Get the board socket from server card storage
    const boardSocket = this.serverCardStorage?.getBoardSocket(request.boardId);

    if (!boardSocket) {
      // Fallback to workspace card storage
      const fallbackSocket = this.context.cardStorage.getBoardSocket(
        request.boardId,
      );
      if (!fallbackSocket) {
        throw new Error(`No connection to board ${request.boardId}`);
      }

      this.logger.debug("Using fallback board socket for query", {
        requestId: request.requestId,
        boardId: request.boardId,
        query: request.query,
      });

      return querySocket(
        fallbackSocket,
        request.query,
        ...(request.data as any),
      );
    }

    this.logger.debug("Forwarding query to board via server storage", {
      requestId: request.requestId,
      boardId: request.boardId,
      query: request.query,
    });

    return querySocket(boardSocket, request.query, ...(request.data as any));
  }

  /**
   * Find workspace ID by socket connection
   */
  private findWorkspaceIdBySocket(_socket: any): string | undefined {
    for (const [
      workspaceId,
      _workspace,
    ] of this.connectedWorkspaces.entries()) {
      // Note: In a real implementation, we'd need to track socket IDs per workspace
      // For now, we'll return the first workspace (single workspace assumption)
      if (this.connectedWorkspaces.size === 1) {
        return workspaceId;
      }
    }
    return undefined;
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
    // Enhanced logging for event routing decisions
    this.logger.info("🎯 EVENT ROUTING: Board-specific broadcast", {
      timestamp: new Date().toISOString(),
      boardId,
      eventType,
      direction: "server->clients",
      dataType: typeof data,
      hasWorkspaceNamespace: !!this.workspaceNamespace,
    });

    if (!this.workspaceNamespace) {
      this.logger.warn("❌ Cannot broadcast - no workspace namespace", {
        timestamp: new Date().toISOString(),
        boardId,
        eventType,
      });
      return;
    }

    // Get workspaces assigned to this board using the board assignment system
    const assignedWorkspaces = this.boardWorkspaceMap.get(boardId);
    const assignedWorkspaceIds = assignedWorkspaces
      ? Array.from(assignedWorkspaces)
      : [];

    if (!assignedWorkspaces || assignedWorkspaces.size === 0) {
      this.logger.info(
        "📡 No board assignments - broadcasting to ALL workspaces",
        {
          timestamp: new Date().toISOString(),
          boardId,
          eventType,
          connectedWorkspaceCount: this.connectedWorkspaces.size,
          connectedWorkspaceIds: Array.from(this.connectedWorkspaces.keys()),
        },
      );
      // If no specific assignments, broadcast to all connected workspaces
      this.broadcastToWorkspaces(eventType, data);
      return;
    }

    let broadcastCount = 0;
    const targetWorkspaces: string[] = [];
    const skippedWorkspaces: string[] = [];

    for (const workspaceId of assignedWorkspaces) {
      // Check if workspace is connected
      if (this.connectedWorkspaces.has(workspaceId)) {
        // Broadcast to specific workspace room
        this.workspaceNamespace.to(workspaceId).emit(eventType, data);
        broadcastCount++;
        targetWorkspaces.push(workspaceId);

        this.logger.debug("📤 OUTGOING WebSocket: Event to workspace", {
          timestamp: new Date().toISOString(),
          targetWorkspaceId: workspaceId,
          boardId,
          eventType,
          direction: "server->client",
        });
      } else {
        skippedWorkspaces.push(workspaceId);
      }
    }

    this.logger.info("✅ Event broadcast completed", {
      timestamp: new Date().toISOString(),
      boardId,
      eventType,
      assignedWorkspaceCount: assignedWorkspaces.size,
      assignedWorkspaceIds,
      connectedTargetCount: broadcastCount,
      targetWorkspaces,
      skippedWorkspaces,
      totalConnectedWorkspaces: this.connectedWorkspaces.size,
    });
  }

  /**
   * Handle board assignment request from workspace client
   */
  private async handleBoardAssignmentRequest(
    socket: any,
    request: {
      type: "boardAssignmentRequest";
      workspaceId: string;
      boardIds: string[];
    },
  ): Promise<void> {
    this.logger.info("Processing board assignment request", {
      workspaceId: request.workspaceId,
      requestedBoards: request.boardIds,
    });

    const assignedBoards: string[] = [];
    const deniedBoards: string[] = [];

    for (const boardId of request.boardIds) {
      try {
        const hasAccess = await this.assignBoardToWorkspace(
          request.workspaceId,
          boardId,
        );
        if (hasAccess) {
          assignedBoards.push(boardId);
        } else {
          deniedBoards.push(boardId);
        }
      } catch (error) {
        this.logger.error("Error assigning board to workspace", {
          workspaceId: request.workspaceId,
          boardId,
          error: error instanceof Error ? error.message : String(error),
        });
        deniedBoards.push(boardId);
      }
    }

    // Send response back to workspace
    socket.emit("boardAssignmentResponse", {
      type: "boardAssignmentResponse",
      workspaceId: request.workspaceId,
      assignedBoards,
      deniedBoards,
    });

    this.logger.info("Board assignment request completed", {
      workspaceId: request.workspaceId,
      assignedCount: assignedBoards.length,
      deniedCount: deniedBoards.length,
    });
  }

  /**
   * Assign a board to a workspace
   */
  private async assignBoardToWorkspace(
    workspaceId: string,
    boardId: string,
  ): Promise<boolean> {
    // Check if workspace exists
    if (!this.connectedWorkspaces.has(workspaceId)) {
      this.logger.warn("Cannot assign board - workspace not connected", {
        workspaceId,
        boardId,
      });
      return false;
    }

    // Get or create workspace board assignment
    let assignment = this.workspaceBoardAssignments.get(workspaceId);
    if (!assignment) {
      assignment = {
        workspaceId,
        assignedBoards: new Set<string>(),
        lastActivity: new Date(),
        permissions: { ...DEFAULT_BOARD_PERMISSIONS },
      };
      this.workspaceBoardAssignments.set(workspaceId, assignment);
    }

    // Check board limits
    if (
      this.boardAssignmentConfig.maxBoardsPerWorkspace > 0 &&
      assignment.assignedBoards.size >=
        this.boardAssignmentConfig.maxBoardsPerWorkspace
    ) {
      this.logger.warn("Cannot assign board - workspace board limit reached", {
        workspaceId,
        boardId,
        currentBoards: assignment.assignedBoards.size,
        maxBoards: this.boardAssignmentConfig.maxBoardsPerWorkspace,
      });
      return false;
    }

    // Assign board to workspace
    assignment.assignedBoards.add(boardId);
    assignment.lastActivity = new Date();

    // Update board-to-workspace mapping
    let workspaces = this.boardWorkspaceMap.get(boardId);
    if (!workspaces) {
      workspaces = new Set<string>();
      this.boardWorkspaceMap.set(boardId, workspaces);
    }
    workspaces.add(workspaceId);

    this.logger.info("Board assigned to workspace", {
      workspaceId,
      boardId,
      totalAssignedBoards: assignment.assignedBoards.size,
    });

    // Broadcast board assignment event to the specific workspace
    if (this.workspaceNamespace && this.connectedWorkspaces.has(workspaceId)) {
      this.workspaceNamespace.to(workspaceId).emit("boardAssigned", {
        type: "boardAssigned",
        workspaceId,
        boardId,
      });
    }

    return true;
  }

  /**
   * Remove a board from a workspace
   */
  private removeBoardFromWorkspace(
    workspaceId: string,
    boardId: string,
  ): boolean {
    const assignment = this.workspaceBoardAssignments.get(workspaceId);
    if (!assignment) {
      return false;
    }

    // Remove board from workspace assignment
    const wasRemoved = assignment.assignedBoards.delete(boardId);
    if (wasRemoved) {
      assignment.lastActivity = new Date();

      // Update board-to-workspace mapping
      const workspaces = this.boardWorkspaceMap.get(boardId);
      if (workspaces) {
        workspaces.delete(workspaceId);
        if (workspaces.size === 0) {
          this.boardWorkspaceMap.delete(boardId);
        }
      }

      this.logger.info("Board removed from workspace", {
        workspaceId,
        boardId,
        remainingBoards: assignment.assignedBoards.size,
      });

      // Broadcast board unassignment event to the specific workspace
      if (
        this.workspaceNamespace &&
        this.connectedWorkspaces.has(workspaceId)
      ) {
        this.workspaceNamespace.to(workspaceId).emit("boardUnassigned", {
          type: "boardUnassigned",
          workspaceId,
          boardId,
        });
      }
    }

    return wasRemoved;
  }

  /**
   * Start the health check system for workspace connections
   */
  private startHealthCheckSystem(): void {
    this.logger.info("Starting workspace health check system", {
      interval: this.HEALTH_CHECK_INTERVAL,
      staleTimeout: this.STALE_CONNECTION_TIMEOUT,
    });

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Perform health checks on all connected workspaces
   */
  private performHealthChecks(): void {
    const now = Date.now();
    const staleWorkspaces: string[] = [];
    const disconnectedWorkspaces: string[] = [];

    for (const [workspaceId, workspace] of this.connectedWorkspaces) {
      const timeSinceLastHealthCheck = now - workspace.lastHealthCheck;

      if (timeSinceLastHealthCheck > this.STALE_CONNECTION_TIMEOUT) {
        if (
          workspace.connectionStatus === WorkspaceConnectionStatus.CONNECTED
        ) {
          // Mark as stale
          workspace.connectionStatus = WorkspaceConnectionStatus.STALE;
          staleWorkspaces.push(workspaceId);

          this.logger.warn("Workspace connection marked as stale", {
            workspaceId,
            timeSinceLastHealthCheck,
            lastHealthCheck: new Date(workspace.lastHealthCheck).toISOString(),
          });
        } else if (
          workspace.connectionStatus === WorkspaceConnectionStatus.STALE &&
          timeSinceLastHealthCheck > this.STALE_CONNECTION_TIMEOUT * 2
        ) {
          // Remove completely stale connections
          disconnectedWorkspaces.push(workspaceId);
        }
      }
    }

    // Send health check pings to connected workspaces
    if (this.workspaceNamespace) {
      this.workspaceNamespace.emit("healthCheck", {
        type: "healthCheck",
        timestamp: now,
      });
    }

    // Clean up disconnected workspaces
    for (const workspaceId of disconnectedWorkspaces) {
      this.handleWorkspaceDisconnection(workspaceId, "health_check_timeout");
    }

    if (staleWorkspaces.length > 0 || disconnectedWorkspaces.length > 0) {
      this.logger.info("Health check completed", {
        totalWorkspaces: this.connectedWorkspaces.size,
        staleWorkspaces: staleWorkspaces.length,
        disconnectedWorkspaces: disconnectedWorkspaces.length,
      });
    }
  }

  /**
   * Handle workspace disconnection with cleanup
   */
  private handleWorkspaceDisconnection(
    workspaceId: string,
    reason: string,
  ): void {
    const workspace = this.connectedWorkspaces.get(workspaceId);
    if (!workspace) {
      return;
    }

    this.logger.info("Handling workspace disconnection", {
      workspaceId,
      reason,
      connectedDuration: Date.now() - workspace.connectedAt.getTime(),
    });

    // Update connection status
    workspace.connectionStatus = WorkspaceConnectionStatus.DISCONNECTED;

    // Clean up board assignments for this workspace
    const assignment = this.workspaceBoardAssignments.get(workspaceId);
    if (assignment) {
      for (const boardId of assignment.assignedBoards) {
        const boardWorkspaces = this.boardWorkspaceMap.get(boardId);
        if (boardWorkspaces) {
          boardWorkspaces.delete(workspaceId);
          if (boardWorkspaces.size === 0) {
            this.boardWorkspaceMap.delete(boardId);
          }
        }
      }
      this.workspaceBoardAssignments.delete(workspaceId);
    }

    // Remove from connected workspaces
    this.connectedWorkspaces.delete(workspaceId);

    // Broadcast disconnection event
    if (this.workspaceNamespace) {
      this.workspaceNamespace.emit("workspaceDisconnected", {
        type: "workspaceDisconnected",
        workspaceId,
        reason,
      });
    }

    this.logger.info("Workspace disconnection cleanup completed", {
      workspaceId,
      remainingWorkspaces: this.connectedWorkspaces.size,
    });
  }

  /**
   * Update workspace health check timestamp
   */
  private updateWorkspaceHealthCheck(workspaceId: string): void {
    const workspace = this.connectedWorkspaces.get(workspaceId);
    if (workspace) {
      workspace.lastHealthCheck = Date.now();
      workspace.lastActivity = new Date();

      // Update connection status if it was stale
      if (workspace.connectionStatus === WorkspaceConnectionStatus.STALE) {
        workspace.connectionStatus = WorkspaceConnectionStatus.CONNECTED;
        this.logger.info("Workspace connection restored from stale state", {
          workspaceId,
        });
      }
    }
  }

  /**
   * Check if a workspace has access to a board
   */
  private checkBoardAccess(workspaceId: string, boardId: string): boolean {
    // If explicit assignment is not required, allow access
    if (!this.boardAssignmentConfig.requireExplicitAssignment) {
      return true;
    }

    const assignment = this.workspaceBoardAssignments.get(workspaceId);
    if (!assignment) {
      return false;
    }

    return assignment.assignedBoards.has(boardId);
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

    // Handle query proxy requests
    socket.on(
      "queryRequest",
      (request: {
        type: "queryRequest";
        requestId: string;
        boardId: string;
        query: keyof Queries;
        data: any[];
        timeout?: number;
      }) => {
        this.handleQueryProxyRequest(socket, request);
      },
    );

    // Handle board assignment requests
    socket.on(
      "boardAssignmentRequest",
      (request: {
        type: "boardAssignmentRequest";
        workspaceId: string;
        boardIds: string[];
      }) => {
        this.handleBoardAssignmentRequest(socket, request);
      },
    );

    // Handle workspace disconnection
    socket.on("disconnect", (reason: string) => {
      this.handleWorkspaceDisconnectionBySocket(socket, reason);
    });

    // Handle health check responses
    socket.on(
      "healthCheckResponse",
      (data: { workspaceId: string; timestamp: number }) => {
        this.updateWorkspaceHealthCheck(data.workspaceId);
        this.logger.debug("Health check response received", {
          workspaceId: data.workspaceId,
          responseTime: Date.now() - data.timestamp,
        });
      },
    );

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
        connectionStatus: WorkspaceConnectionStatus.CONNECTED,
        lastHealthCheck: Date.now(),
        reconnectCount: 0,
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
   * Handle workspace disconnection by socket
   */
  private handleWorkspaceDisconnectionBySocket(
    socket: any,
    reason: string,
  ): void {
    // Find and remove workspace by socket
    for (const [
      _workspaceId,
      _workspace,
    ] of this.connectedWorkspaces.entries()) {
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

    if (this.featureFlagManager?.isEnabled("enableQueryProxying")) {
      features.push("queryProxying");
    }

    // Board assignment is always available when workspace websockets are enabled
    if (this.featureFlagManager?.isEnabled("enableWorkspaceWebsockets")) {
      features.push("boardAssignment");
      features.push("workspaceEventRouting");
      features.push("workspaceConnectionMonitoring");
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

    // Clean up health check system
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Clean up pending queries and timeouts
    this.queryTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.queryTimeouts.clear();
    this.pendingQueries.clear();

    // Clean up board assignments
    this.workspaceBoardAssignments.clear();
    this.boardWorkspaceMap.clear();

    // Clean up workspace connections
    this.connectedWorkspaces.clear();

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
    socket.on("navigateTo", async (card) => {
      // Enhanced logging for navigation events from Miro
      this.logger.info("🎯 MIRO EVENT: Navigate to card", {
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

      this.fire({ type: "navigateToCard", card });
    });
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
