import { EventEmitter } from "events";
import { Socket, io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import {
  DEFAULT_RETRY_CONFIG,
  MiroToWorkspaceEvents,
  QueryFunction,
  QueryResultFunction,
  RetryConfig,
  WorkspaceToMiroOperations,
} from "./EventTypes";
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

type WorkspaceEvents = {
  error: [
    {
      error: string;
      code?: string;
    },
  ];
  stateChange: [
    {
      previousState: WorkspaceClientState;
      state: WorkspaceClientState;
    },
  ];
};

/**
 * Workspace websocket client for connecting to the server's /workspace namespace
 */
export class WorkspaceWebsocketClient
  extends EventEmitter<
    WorkspaceEvents & {
      [K in keyof MiroToWorkspaceEvents]: Parameters<MiroToWorkspaceEvents[K]>;
    }
  >
  implements vscode.Disposable
{
  private socket?: Socket<
    QueryResultFunction<WorkspaceToMiroOperations> & MiroToWorkspaceEvents,
    QueryFunction<WorkspaceToMiroOperations>
  >;

  getSocket() {
    return this.socket;
  }
  private state: WorkspaceClientState = "disconnected";
  private logger = createLogger("workspace-client");
  private reconnectTimer?: NodeJS.Timeout;
  private retryConfig: RetryConfig;
  private currentRetryAttempt = 0;

  constructor(private options: WorkspaceClientOptions) {
    super();

    // Initialize retry configuration
    this.retryConfig = options.retryConfig || DEFAULT_RETRY_CONFIG;

    this.logger.debug("WorkspaceWebsocketClient initialized", {
      serverUrl: options.serverUrl,
      workspaceId: options.workspaceId,
      retryConfig: this.retryConfig,
    });
  }

  /**
   * Connect to the server's workspace websocket
   */
  async connect(): Promise<void> {
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
        reconnection: true,
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
    });

    // Connection error
    this.socket.on("connect_error", (error: any) => {
      this.logger.error("Workspace websocket connection error", { error });
      this.setState("error");
      this.emit("error", { error: String(error), code: "CONNECTION_ERROR" });
    });

    // Disconnection
    this.socket.on("disconnect", (reason: string) => {
      this.logger.warn("Disconnected from workspace websocket server", {
        reason,
      });
      this.setState("disconnected");

      // Attempt reconnection if not manually disconnected
      if (reason !== "io client disconnect") {
        this.scheduleReconnect();
      }
    });

    this.socket.on("navigateTo", (card) => {
      // Enhanced logging for navigation events - this is key for debugging card clicks
      this.logger.info("📥 INCOMING WebSocket: Navigate to card event", {
        timestamp: new Date().toISOString(),
        workspaceId: this.options.workspaceId,
        messageType: "navigateTo",
        direction: "server->client",
        cardTitle: card.title,
        cardPath: card.path,
        cardSymbol: card.type === "symbol" ? card.symbol : undefined,
        cardBoardId: card.boardId,
        cardMiroLink: card.miroLink,
        cardStatus: card.status,
      });

      this.emit("navigateTo", card);
    });

    this.socket.on(
      "connectionStatus",
      (data: { connectedBoards: string[] }) => {
        this.logger.debug("Connection status event", {
          connectedBoards: data.connectedBoards,
        });
        this.emit("connectionStatus", {
          type: "connectionStatus",
          connectedBoards: data.connectedBoards,
        });
      },
    );
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

    // Add jitter to prevent thundering herd issues
    const delay = this.retryConfig.jitter
      ? baseDelay + Math.random() * baseDelay * 0.1 // Add up to 10% jitter
      : baseDelay;

    this.currentRetryAttempt++;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

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
   * Disconnect from server
   */
  disconnect(): void {
    this.logger.info("Disconnecting from workspace websocket server");

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
   * Dispose of resources
   */
  dispose(): void {
    this.logger.debug("Disposing WorkspaceWebsocketClient resources");

    this.disconnect();
    this.removeAllListeners();
    this.logger.debug("WorkspaceWebsocketClient disposed");
  }
}
