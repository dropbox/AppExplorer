import { EventEmitter } from "events";
import { io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import {
  BoardInfo,
  CardData,
  DEFAULT_QUERY_PROXY_CONFIG,
  DEFAULT_RETRY_CONFIG,
  Queries,
  QueryProxyConfig,
  RetryConfig,
  ServerCapabilities,
  WorkspaceRegistrationRequest,
  WorkspaceRegistrationResponse,
} from "./EventTypes";
import { HandlerContext } from "./extension";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";

// Import socket.io-client for workspace connections

export type WorkspaceClientState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "registered"
  | "error";

export interface WorkspaceClientOptions {
  serverUrl: string;
  workspaceId: string;
  workspaceName?: string;
  rootPath?: string;
  retryConfig?: RetryConfig;
}

export interface WorkspaceClientEvents {
  stateChange: {
    state: WorkspaceClientState;
    previousState: WorkspaceClientState;
  };
  serverCapabilities: { capabilities: ServerCapabilities };
  registrationComplete: { response: WorkspaceRegistrationResponse };
  boardConnected: { boardInfo: BoardInfo };
  boardDisconnected: { boardId: string };
  cardUpdate: { boardId: string; card: CardData };
  cardDelete: { boardId: string; miroLink: string };
  navigateToCard: { card: CardData };
  connectionStatus: { connectedBoards: string[] };
  error: { error: string; code?: string };
}

/**
 * Workspace websocket client for connecting to the server's /workspace namespace
 */
export class WorkspaceWebsocketClient
  extends EventEmitter
  implements vscode.Disposable
{
  private socket?: any; // Socket.IO client socket
  private state: WorkspaceClientState = "disconnected";
  private logger = createLogger("workspace-client");
  private reconnectTimer?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private serverCapabilities?: ServerCapabilities;
  private retryConfig: RetryConfig;
  private currentRetryAttempt = 0;
  private currentRetryDelay = 0;
  private queryProxyConfig: QueryProxyConfig;
  private pendingQueries = new Map<
    string,
    {
      resolve: (result: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
      query: keyof Queries;
      boardId: string;
      timestamp: number;
    }
  >();

  constructor(
    private options: WorkspaceClientOptions,
    private featureFlagManager: FeatureFlagManager,
    private handlerContext: HandlerContext,
  ) {
    super();

    // Initialize retry configuration
    this.retryConfig = options.retryConfig || DEFAULT_RETRY_CONFIG;
    this.currentRetryDelay = this.retryConfig.initialDelay;

    // Initialize query proxy configuration
    this.queryProxyConfig = DEFAULT_QUERY_PROXY_CONFIG;

    this.logger.debug("WorkspaceWebsocketClient initialized", {
      serverUrl: options.serverUrl,
      workspaceId: options.workspaceId,
      retryConfig: this.retryConfig,
      queryProxyEnabled: this.featureFlagManager.isEnabled(
        "enableQueryProxying",
      ),
    });
  }

  /**
   * Connect to the server's workspace websocket
   */
  async connect(): Promise<void> {
    if (!this.featureFlagManager.isEnabled("enableWorkspaceWebsockets")) {
      throw new Error("Workspace websockets are disabled");
    }

    if (
      this.state === "connecting" ||
      this.state === "connected" ||
      this.state === "registered"
    ) {
      this.logger.debug("Already connected or connecting");
      return;
    }

    this.setState("connecting");
    this.logger.info("Connecting to workspace websocket server", {
      serverUrl: this.options.serverUrl,
    });

    try {
      // Connect to the /workspace namespace
      const wsUrl = `${this.options.serverUrl}/workspace`;
      const connectionTimeout = 10000; // 10 second connection timeout

      this.socket = socketIO(wsUrl, {
        transports: ["websocket"],
        timeout: connectionTimeout,
        reconnection: false, // We'll handle reconnection manually
        forceNew: true, // Force new connection on each attempt
      });

      // Set up connection timeout handler
      const timeoutHandler = setTimeout(() => {
        if (this.state === "connecting") {
          this.logger.warn("Connection timeout exceeded", {
            timeout: connectionTimeout,
          });
          this.socket?.disconnect();
          this.setState("error");
          this.emit("error", {
            error: "Connection timeout",
            code: "CONNECTION_TIMEOUT",
          });
        }
      }, connectionTimeout);

      // Set up socket event handlers with timeout handler
      this.setupSocketEventHandlers(timeoutHandler);
    } catch (error) {
      this.logger.error("Failed to connect to workspace websocket", { error });
      this.setState("error");
      this.emit("error", { error: String(error) });
      throw error;
    }
  }

  /**
   * Set up socket event handlers
   */
  private setupSocketEventHandlers(timeoutHandler?: NodeJS.Timeout): void {
    if (!this.socket) {
      return;
    }

    // Connection established
    this.socket.on("connect", () => {
      this.logger.info("Connected to workspace websocket server");

      // Clear connection timeout if it exists
      if (timeoutHandler) {
        clearTimeout(timeoutHandler);
      }

      this.setState("connected");
      this.resetRetryState(); // Reset retry state on successful connection
      this.startRegistration();
    });

    // Connection error
    this.socket.on("connect_error", (error: any) => {
      this.logger.error("Workspace websocket connection error", { error });
      this.setState("error");
      this.emit("error", { error: String(error) });
    });

    // Disconnection
    this.socket.on("disconnect", (reason: string) => {
      this.logger.warn("Disconnected from workspace websocket server", {
        reason,
      });
      this.setState("disconnected");
      this.stopPingInterval();

      // Attempt reconnection if not manually disconnected
      if (reason !== "io client disconnect") {
        this.scheduleReconnect();
      }
    });

    // Server capabilities
    this.socket.on(
      "serverCapabilities",
      (data: { capabilities: ServerCapabilities }) => {
        this.logger.info("Received server capabilities", {
          capabilities: data.capabilities,
        });
        this.serverCapabilities = data.capabilities;
        this.emit("serverCapabilities", { capabilities: data.capabilities });
      },
    );

    // Registration response
    this.socket.on(
      "workspaceRegistrationResponse",
      (response: WorkspaceRegistrationResponse) => {
        this.handleRegistrationResponse(response);
      },
    );

    // Ping/pong for health monitoring
    this.socket.on("pong", (data: { timestamp: number }) => {
      this.logger.debug("Received pong", { timestamp: data.timestamp });
    });

    // Board and card events
    this.socket.on("boardConnected", (data: { boardInfo: BoardInfo }) => {
      this.logger.debug("Board connected event", { boardInfo: data.boardInfo });
      this.emit("boardConnected", { boardInfo: data.boardInfo });
    });

    this.socket.on("boardDisconnected", (data: { boardId: string }) => {
      this.logger.debug("Board disconnected event", { boardId: data.boardId });
      this.emit("boardDisconnected", { boardId: data.boardId });
    });

    this.socket.on(
      "cardUpdate",
      (data: { boardId: string; card: CardData }) => {
        this.logger.debug("Card update event", {
          boardId: data.boardId,
          cardTitle: data.card?.title,
        });
        this.emit("cardUpdate", { boardId: data.boardId, card: data.card });
      },
    );

    this.socket.on(
      "cardDelete",
      (data: { boardId: string; miroLink: string }) => {
        this.logger.debug("Card delete event", {
          boardId: data.boardId,
          miroLink: data.miroLink,
        });
        this.emit("cardDelete", {
          boardId: data.boardId,
          miroLink: data.miroLink,
        });
      },
    );

    this.socket.on("navigateToCard", (data: { card: CardData }) => {
      // Enhanced logging for navigation events - this is key for debugging card clicks
      this.logger.info("📥 INCOMING WebSocket: Navigate to card event", {
        timestamp: new Date().toISOString(),
        workspaceId: this.options.workspaceId,
        messageType: "navigateToCard",
        direction: "server->client",
        cardTitle: data.card.title,
        cardPath: data.card.path,
        cardSymbol: data.card.type === "symbol" ? data.card.symbol : undefined,
        cardBoardId: data.card.boardId,
        cardMiroLink: data.card.miroLink,
        cardStatus: data.card.status,
      });

      this.emit("navigateToCard", { card: data.card });
    });

    this.socket.on(
      "connectionStatus",
      (data: { connectedBoards: string[] }) => {
        this.logger.debug("Connection status event", {
          connectedBoards: data.connectedBoards,
        });
        this.emit("connectionStatus", {
          connectedBoards: data.connectedBoards,
        });
      },
    );

    // Query response handling
    this.socket.on(
      "queryResponse",
      (response: {
        type: "queryResponse";
        requestId: string;
        result?: any;
        error?: string;
        duration?: number;
      }) => {
        this.handleQueryResponse(response);
      },
    );

    // Error handling
    this.socket.on("error", (data: { message: string; code?: string }) => {
      this.logger.error("Workspace websocket error", {
        message: data.message,
        code: data.code,
      });
      this.emit("error", { error: data.message, code: data.code });
    });
  }

  /**
   * Start workspace registration process
   */
  private async startRegistration(): Promise<void> {
    if (!this.socket || this.state !== "connected") {
      this.logger.warn("Cannot start registration - invalid state", {
        hasSocket: !!this.socket,
        state: this.state,
      });
      return;
    }

    try {
      this.logger.info("Starting workspace registration");

      // Get current workspace boards
      const boardIds = this.handlerContext.cardStorage.listBoardIds();

      const registrationRequest: WorkspaceRegistrationRequest = {
        workspaceId: this.options.workspaceId,
        workspaceName: this.options.workspaceName,
        rootPath: this.options.rootPath,
        boardIds,
        capabilities: this.getWorkspaceCapabilities(),
      };

      // Enhanced logging for workspace registration
      this.logger.info("🚀 OUTGOING WebSocket: Workspace registration", {
        timestamp: new Date().toISOString(),
        workspaceId: registrationRequest.workspaceId,
        workspaceName: registrationRequest.workspaceName,
        boardCount: boardIds.length,
        boardIds: boardIds,
        capabilities: registrationRequest.capabilities,
        messageType: "workspaceRegistration",
        direction: "client->server",
      });

      this.logger.debug("📤 WebSocket emit details", {
        timestamp: new Date().toISOString(),
        event: "workspaceRegistration",
        payload: registrationRequest,
      });

      this.socket.emit("workspaceRegistration", registrationRequest);
    } catch (error) {
      this.logger.error("Error during workspace registration", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.setState("error");
      this.emit("error", { error: "Registration failed" });
    }
  }

  /**
   * Handle workspace registration response
   */
  private handleRegistrationResponse(
    response: WorkspaceRegistrationResponse,
  ): void {
    if (response.success) {
      this.logger.info("Workspace registration successful", {
        workspaceId: response.workspaceId,
        assignedBoards: response.assignedBoards,
      });

      this.setState("registered");
      this.startPingInterval();
      this.emit("registrationComplete", { response });
    } else {
      this.logger.error("Workspace registration failed", {
        error: response.error,
        workspaceId: response.workspaceId,
      });

      this.setState("error");
      this.emit("error", { error: response.error || "Registration failed" });
    }
  }

  /**
   * Get workspace capabilities
   */
  private getWorkspaceCapabilities(): string[] {
    const capabilities: string[] = ["cardStorage", "navigation"];

    if (this.featureFlagManager.isEnabled("enableDualStorage")) {
      capabilities.push("dualStorage");
    }

    return capabilities;
  }

  /**
   * Start ping interval for health monitoring
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.socket && this.state === "registered") {
        const pingMessage = { timestamp: Date.now() };

        this.logger.debug("🏓 OUTGOING WebSocket: Ping", {
          timestamp: new Date().toISOString(),
          workspaceId: this.options.workspaceId,
          messageType: "ping",
          direction: "client->server",
          pingTimestamp: pingMessage.timestamp,
        });

        this.socket.emit("ping", pingMessage);
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }

    // Check if we've exceeded max retry attempts
    if (this.currentRetryAttempt >= this.retryConfig.maxRetries) {
      this.logger.error("Max retry attempts exceeded, giving up", {
        attempts: this.currentRetryAttempt,
        maxRetries: this.retryConfig.maxRetries,
      });
      this.setState("error");
      this.emit("error", {
        error: `Max retry attempts (${this.retryConfig.maxRetries}) exceeded`,
        code: "MAX_RETRIES_EXCEEDED",
      });
      return;
    }

    // Calculate delay with exponential backoff
    const baseDelay = Math.min(
      this.retryConfig.initialDelay *
        Math.pow(this.retryConfig.backoffMultiplier, this.currentRetryAttempt),
      this.retryConfig.maxDelay,
    );

    // Add jitter if enabled to prevent thundering herd
    const delay = this.retryConfig.jitter
      ? baseDelay + Math.random() * baseDelay * 0.1 // Add up to 10% jitter
      : baseDelay;

    this.currentRetryAttempt++;
    this.currentRetryDelay = delay;

    this.logger.info("Scheduling reconnection with exponential backoff", {
      attempt: this.currentRetryAttempt,
      delay: Math.round(delay),
      maxRetries: this.retryConfig.maxRetries,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.attemptReconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect to the server
   */
  private async attemptReconnect(): Promise<void> {
    this.logger.debug("Attempting reconnection", {
      attempt: this.currentRetryAttempt,
      maxRetries: this.retryConfig.maxRetries,
    });

    try {
      await this.connect();
      // Connection successful - reset retry state
      this.resetRetryState();
      this.logger.info("Reconnection successful", {
        attemptsUsed: this.currentRetryAttempt,
      });
    } catch (error) {
      this.logger.warn("Reconnection attempt failed", {
        attempt: this.currentRetryAttempt,
        error: error instanceof Error ? error.message : String(error),
      });

      // Schedule next retry attempt
      this.scheduleReconnect();
    }
  }

  /**
   * Reset retry state after successful connection
   */
  private resetRetryState(): void {
    this.currentRetryAttempt = 0;
    this.currentRetryDelay = this.retryConfig.initialDelay;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  /**
   * Set client state and emit state change event
   */
  private setState(newState: WorkspaceClientState): void {
    const previousState = this.state;
    this.state = newState;

    this.logger.debug("State changed", { from: previousState, to: newState });
    this.emit("stateChange", { state: newState, previousState });
  }

  /**
   * Get current client state
   */
  getState(): WorkspaceClientState {
    return this.state;
  }

  /**
   * Get server capabilities (if received)
   */
  getServerCapabilities(): ServerCapabilities | undefined {
    return this.serverCapabilities;
  }

  /**
   * Get current retry state information
   */
  getRetryState(): {
    currentAttempt: number;
    maxRetries: number;
    currentDelay: number;
    isRetrying: boolean;
  } {
    return {
      currentAttempt: this.currentRetryAttempt,
      maxRetries: this.retryConfig.maxRetries,
      currentDelay: this.currentRetryDelay,
      isRetrying: !!this.reconnectTimer,
    };
  }

  /**
   * Manually trigger reconnection (resets retry state)
   */
  async reconnect(): Promise<void> {
    this.logger.info("Manual reconnection triggered");

    // Disconnect current connection if exists
    if (this.socket) {
      this.socket.disconnect();
    }

    // Reset retry state for fresh start
    this.resetRetryState();

    // Attempt connection
    await this.connect();
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.logger.info("Disconnecting from workspace websocket server");

    this.stopPingInterval();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
    }

    this.setState("disconnected");
  }

  /**
   * Proxy a query through the server to a Miro board
   */
  async proxyQuery<T extends keyof Queries>(
    boardId: string,
    query: T,
    ...data: Parameters<Queries[T]>
  ): Promise<Awaited<ReturnType<Queries[T]>>> {
    if (!this.featureFlagManager.isEnabled("enableQueryProxying")) {
      throw new Error("Query proxying is disabled");
    }

    if (this.state !== "registered") {
      throw new Error("Workspace not registered with server");
    }

    if (!this.socket) {
      throw new Error("No websocket connection to server");
    }

    const requestId = this.generateRequestId();
    const timeout = this.queryProxyConfig.timeout;

    // Enhanced logging for outgoing WebSocket messages
    this.logger.info("🔄 OUTGOING WebSocket: Query proxy request", {
      timestamp: new Date().toISOString(),
      workspaceId: this.options.workspaceId,
      requestId,
      boardId,
      query: String(query),
      dataLength: data.length,
      timeout,
      messageType: "queryRequest",
      direction: "client->server",
    });

    return new Promise<Awaited<ReturnType<Queries[T]>>>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingQueries.delete(requestId);
        this.logger.warn("⏰ Query proxy request timed out", {
          timestamp: new Date().toISOString(),
          workspaceId: this.options.workspaceId,
          requestId,
          boardId,
          query: String(query),
          timeout,
        });
        reject(
          new Error(`Query ${String(query)} timed out after ${timeout}ms`),
        );
      }, timeout);

      // Store pending query
      this.pendingQueries.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        query,
        boardId,
        timestamp: Date.now(),
      });

      // Send query request to server with enhanced logging
      const queryMessage = {
        type: "queryRequest",
        requestId,
        boardId,
        query,
        data: data as any[],
        timeout,
      };

      this.logger.debug("📤 WebSocket emit details", {
        timestamp: new Date().toISOString(),
        workspaceId: this.options.workspaceId,
        event: "queryRequest",
        payload: queryMessage,
      });

      this.socket!.emit("queryRequest", queryMessage);
    });
  }

  /**
   * Handle query response from server
   */
  private handleQueryResponse(response: {
    type: "queryResponse";
    requestId: string;
    result?: any;
    error?: string;
    duration?: number;
  }): void {
    // Enhanced logging for incoming query responses
    this.logger.info("📥 INCOMING WebSocket: Query response", {
      timestamp: new Date().toISOString(),
      workspaceId: this.options.workspaceId,
      messageType: "queryResponse",
      direction: "server->client",
      requestId: response.requestId,
      hasError: !!response.error,
      hasResult: !!response.result,
      serverDuration: response.duration ? `${response.duration}ms` : undefined,
    });

    const pendingQuery = this.pendingQueries.get(response.requestId);
    if (!pendingQuery) {
      this.logger.warn("❌ Received response for unknown query", {
        timestamp: new Date().toISOString(),
        workspaceId: this.options.workspaceId,
        requestId: response.requestId,
        pendingQueryCount: this.pendingQueries.size,
      });
      return;
    }

    // Clean up
    clearTimeout(pendingQuery.timeout);
    this.pendingQueries.delete(response.requestId);

    const duration = Date.now() - pendingQuery.timestamp;

    if (response.error) {
      this.logger.error("❌ Query proxy request failed", {
        timestamp: new Date().toISOString(),
        workspaceId: this.options.workspaceId,
        requestId: response.requestId,
        boardId: pendingQuery.boardId,
        query: String(pendingQuery.query),
        error: response.error,
        clientDuration: `${duration}ms`,
        serverDuration: response.duration
          ? `${response.duration}ms`
          : undefined,
      });

      pendingQuery.reject(new Error(response.error));
    } else {
      this.logger.info("✅ Query proxy request successful", {
        timestamp: new Date().toISOString(),
        workspaceId: this.options.workspaceId,
        requestId: response.requestId,
        boardId: pendingQuery.boardId,
        query: String(pendingQuery.query),
        clientDuration: `${duration}ms`,
        serverDuration: response.duration
          ? `${response.duration}ms`
          : undefined,
        resultType: typeof response.result,
      });

      pendingQuery.resolve(response.result);
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `${this.options.workspaceId}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Check if query proxying is available
   */
  isQueryProxyingAvailable(): boolean {
    return (
      this.featureFlagManager.isEnabled("enableQueryProxying") &&
      this.state === "registered" &&
      this.serverCapabilities?.supportedFeatures.includes("queryProxying") ===
        true
    );
  }

  /**
   * Get query proxy statistics
   */
  getQueryProxyStats(): {
    pendingQueries: number;
    isAvailable: boolean;
    serverCapabilities?: string[];
  } {
    return {
      pendingQueries: this.pendingQueries.size,
      isAvailable: this.isQueryProxyingAvailable(),
      serverCapabilities: this.serverCapabilities?.supportedFeatures,
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.logger.debug("Disposing WorkspaceWebsocketClient resources");

    // Clean up pending queries
    this.pendingQueries.forEach((query, _requestId) => {
      clearTimeout(query.timeout);
      query.reject(new Error("Client disposed"));
    });
    this.pendingQueries.clear();

    this.disconnect();
    this.removeAllListeners();
    this.logger.debug("WorkspaceWebsocketClient disposed");
  }
}
