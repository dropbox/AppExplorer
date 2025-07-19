import { EventEmitter } from "events";
import type { Socket } from "socket.io";
import * as vscode from "vscode";
import {
  BoardInfo,
  CardStorage,
  createVSCodeCardStorage,
} from "./card-storage";
import { CardData } from "./EventTypes";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";
import { WorkspaceWebsocketClient } from "./workspace-websocket-client";

/**
 * CardStorage proxy that routes operations through workspace websocket client
 * instead of direct VSCode storage. Enables true multi-workspace support.
 *
 * This class uses composition to wrap a CardStorage instance and provides
 * the same interface while adding proxy functionality for workspace communication.
 */
export class WorkspaceCardStorageProxy
  extends EventEmitter
  implements vscode.Disposable
{
  // Use composition instead of inheritance for cleaner interface
  private underlyingStorage: CardStorage;
  private logger = createLogger("workspace-card-proxy");
  private isInitializing = false; // Flag to prevent event emission during initialization
  private callStack = new Set<string>(); // Track method calls to detect recursion

  // CardStorage interface compatibility properties
  get storage(): any {
    return (this.underlyingStorage as any).storage;
  }

  get connectedBoards(): string[] {
    return this.underlyingStorage.getConnectedBoards();
  }

  totalCards(): number {
    return this.underlyingStorage.totalCards();
  }

  // Expose private properties for compatibility (using any to access private members)
  get boards(): any {
    return (this.underlyingStorage as any).boards;
  }

  get sockets(): any {
    return (this.underlyingStorage as any).sockets;
  }

  constructor(
    private context: vscode.ExtensionContext,
    private featureFlagManager: FeatureFlagManager,
    private workspaceClient?: WorkspaceWebsocketClient,
  ) {
    // Call EventEmitter constructor
    super();

    // Create VSCode-backed storage internally - this eliminates the need for dual storage pattern
    this.underlyingStorage = createVSCodeCardStorage(context);

    this.logger.debug("WorkspaceCardStorageProxy initialized", {
      hasWorkspaceClient: !!workspaceClient,
      queryProxyEnabled: this.featureFlagManager.isEnabled(
        "enableQueryProxying",
      ),
      storageType: "vscode-backed",
    });
  }

  /**
   * Set the workspace client for proxy operations
   * This allows the proxy to be created early and the client to be set later
   */
  setWorkspaceClient(workspaceClient: WorkspaceWebsocketClient): void {
    this.workspaceClient = workspaceClient;
    this.logger.debug("WorkspaceClient set for proxy operations", {
      hasWorkspaceClient: !!workspaceClient,
      queryProxyEnabled: this.featureFlagManager.isEnabled(
        "enableQueryProxying",
      ),
    });
  }

  dispose(): void {
    // Dispose underlying storage
    this.underlyingStorage.dispose();
    // Clean up event emitter
    this.removeAllListeners();
    this.logger.debug("WorkspaceCardStorageProxy disposed");
  }

  /**
   * Check if workspace proxy is enabled and available
   */
  private isProxyEnabled(): boolean {
    return (
      this.featureFlagManager.isEnabled("enableQueryProxying") &&
      this.workspaceClient?.isQueryProxyingAvailable() === true
    );
  }

  /**
   * Connect a Miro board socket (delegate to underlying storage)
   */
  async connectBoard(boardId: string, socket: Socket): Promise<void> {
    this.logger.info("Connecting board to workspace proxy", { boardId });

    // Delegate to underlying storage
    await this.underlyingStorage.connectBoard(boardId, socket);

    // Initialize board data if not exists
    if (!this.underlyingStorage.getBoard(boardId)) {
      await this.underlyingStorage.addBoard(boardId, "");
    }

    this.logger.info("Board connected to workspace proxy", { boardId });
  }

  /**
   * Get Miro board socket for a specific board (delegate to underlying storage)
   */
  getBoardSocket(boardId: string): Socket | undefined {
    return this.underlyingStorage.getBoardSocket(boardId);
  }

  /**
   * Set board name - proxied through workspace client if available (override parent method)
   */
  setBoardName(boardId: string, name: string): BoardInfo | undefined {
    // Delegate to underlying storage first
    const result = this.underlyingStorage.setBoardName(boardId, name);

    // Try to proxy the operation asynchronously (fire and forget)
    if (this.isProxyEnabled() && this.workspaceClient) {
      this.logger.debug("Proxying setBoardName through workspace client", {
        boardId,
        name,
      });

      // Async operation - don't await to maintain sync interface
      this.workspaceClient
        .proxyQuery(boardId, "setBoardName", name)
        .catch((error) => {
          this.logger.error("Failed to proxy setBoardName", {
            boardId,
            name,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } else {
      // Fallback to direct socket communication (also async)
      const socket = this.getBoardSocket(boardId);
      if (socket) {
        this.logger.debug("Setting board name via direct socket", {
          boardId,
          name,
        });

        const requestId = Math.random().toString(36);
        socket.emit("query", {
          name: "setBoardName",
          requestId,
          data: [name],
        });

        const timeout = setTimeout(() => {
          // Remove listener with proper signature
          socket.removeAllListeners(`queryResult-${requestId}`);
        }, 10000);

        socket.once(`queryResult-${requestId}`, (response: any) => {
          clearTimeout(timeout);
          if (response.error) {
            this.logger.error("setBoardName query failed", {
              boardId,
              name,
              error: response.error,
            });
          }
        });
      }
    }

    return result;
  }

  /**
   * Get board information - proxied through workspace client if available
   */
  async getBoardInfo(
    boardId: string,
  ): Promise<{ name: string; boardId: string }> {
    if (this.isProxyEnabled() && this.workspaceClient) {
      this.logger.debug("Proxying getBoardInfo through workspace client", {
        boardId,
      });

      try {
        const result = await this.workspaceClient.proxyQuery(
          boardId,
          "getBoardInfo",
        );

        // Update local cache
        const board = this.boards.get(boardId);
        if (board) {
          board.name = result.name;
        }

        this.logger.debug("Board info retrieved successfully via proxy", {
          boardId,
          result,
        });
        return result;
      } catch (error) {
        this.logger.error("Failed to get board info via proxy", {
          boardId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else {
      // Fallback to direct socket operation
      const socket = this.getBoardSocket(boardId);
      if (!socket) {
        throw new Error(`No connection to board ${boardId}`);
      }

      this.logger.debug("Getting board info via direct socket", { boardId });

      // Use direct socket query (existing implementation)
      const requestId = Math.random().toString(36);
      return new Promise<{ name: string; boardId: string }>(
        (resolve, reject) => {
          socket.emit("query", {
            name: "getBoardInfo",
            requestId,
            data: [],
          });
          socket.once("queryResult", (response) => {
            resolve(response.response);
          });
          // Add timeout handling
          setTimeout(() => reject(new Error("getBoardInfo timeout")), 10000);
        },
      );
    }
  }

  /**
   * Get all cards for a board - proxied through workspace client if available
   */
  async getBoardCards(boardId: string): Promise<CardData[]> {
    if (this.isProxyEnabled() && this.workspaceClient) {
      this.logger.debug("Proxying cards query through workspace client", {
        boardId,
      });

      try {
        const cards = await this.workspaceClient.proxyQuery(boardId, "cards");

        // Update local cache
        this.setBoardCards(boardId, cards);

        this.logger.debug("Board cards retrieved successfully via proxy", {
          boardId,
          cardCount: cards.length,
        });
        return cards;
      } catch (error) {
        this.logger.error("Failed to get board cards via proxy", {
          boardId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else {
      // Fallback to direct socket operation
      const socket = this.getBoardSocket(boardId);
      if (!socket) {
        throw new Error(`No connection to board ${boardId}`);
      }

      this.logger.debug("Getting board cards via direct socket", { boardId });

      // Use direct socket query (existing implementation)
      const requestId = Math.random().toString(36);
      return new Promise<CardData[]>((resolve, reject) => {
        socket.emit("query", {
          name: "cards",
          requestId,
          data: [],
        });
        socket.once("queryResult", (response) => {
          const cards = response.response;
          this.setBoardCards(boardId, cards);
          resolve(cards);
        });
        // Add timeout handling
        setTimeout(() => reject(new Error("cards query timeout")), 10000);
      });
    }
  }

  /**
   * Set all cards for a board (local cache operation)
   */
  setBoardCards(boardId: string, cards: CardData[]): void {
    const startTime = Date.now();

    this.logger.debug("Setting board cards in local cache", {
      boardId,
      cardCount: cards.length,
      isInitializing: this.isInitializing,
    });

    let board = this.boards.get(boardId);
    if (!board) {
      board = { name: "", cards: {} };
      this.boards.set(boardId, board);
    }

    // Convert array to map for efficient lookups
    board.cards = cards.reduce(
      (acc, card) => {
        if (card.miroLink) {
          acc[card.miroLink] = card;
        }
        return acc;
      },
      {} as Record<string, CardData>,
    );

    const duration = Date.now() - startTime;
    this.logger.debug("Board cards set in local cache", {
      boardId,
      cardCount: cards.length,
      duration: `${duration}ms`,
    });

    // Only emit events if not initializing to prevent circular references
    if (!this.isInitializing) {
      this.emit("boardUpdate", { type: "boardUpdate", boardId, board });
    }
  }

  /**
   * Start initialization mode (prevents event emission)
   */
  startInitialization(): void {
    this.isInitializing = true;
    this.logger.debug("Starting initialization mode");
  }

  /**
   * End initialization mode (re-enables event emission)
   */
  endInitialization(): void {
    this.isInitializing = false;
    this.logger.debug("Ending initialization mode");
  }

  /**
   * Get card by miro link (local cache operation)
   */
  get(miroLink: string): CardData | undefined {
    const methodKey = `get:${miroLink}`;

    // Detect recursion
    if (this.callStack.has(methodKey)) {
      this.logger.error("Recursion detected in get method", {
        miroLink,
        callStack: Array.from(this.callStack),
      });
      return undefined;
    }

    this.callStack.add(methodKey);
    try {
      // Extract board ID from miro link
      try {
        const url = new URL(miroLink);
        const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
        if (match) {
          const boardId = match[1];
          const board = this.boards.get(boardId);
          return board?.cards[miroLink];
        }
      } catch (error) {
        this.logger.warn("Failed to parse miro link", { miroLink, error });
      }
      return undefined;
    } finally {
      this.callStack.delete(methodKey);
    }
  }

  /**
   * List all board IDs
   */
  listBoardIds(): string[] {
    return Array.from(this.boards.keys());
  }

  /**
   * Set card by board ID and card data (compatibility method)
   */
  async setCard(boardIdOrMiroLink: string, card: CardData): Promise<void> {
    // If first parameter looks like a miro link, use it directly
    if (boardIdOrMiroLink.startsWith("http")) {
      this.set(boardIdOrMiroLink, card);
      return;
    }

    // Otherwise treat as boardId
    const boardId = boardIdOrMiroLink;
    if (!card.miroLink) {
      this.logger.warn("Cannot set card without miroLink", { boardId, card });
      return;
    }

    this.set(card.miroLink, card);
  }

  /**
   * Delete card by miro link (compatibility method)
   */
  deleteCardByLink(miroLink: string): void {
    try {
      const url = new URL(miroLink);
      const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
      if (match) {
        const boardId = match[1];
        const board = this.boards.get(boardId);
        if (board && board.cards[miroLink]) {
          delete board.cards[miroLink];

          this.logger.debug("Card deleted from local cache", {
            boardId,
            miroLink,
          });
        }
      }
    } catch (error) {
      this.logger.error("Failed to delete card - invalid miro link", {
        miroLink,
        error,
      });
    }
  }

  /**
   * Get connected boards (compatibility method)
   */
  getConnectedBoards(): string[] {
    return Array.from(this.sockets.keys());
  }

  /**
   * Get board by ID (compatibility method)
   */
  getBoard(
    boardId: string,
  ): { id: string; name: string; cards: Record<string, CardData> } | undefined {
    const board = this.boards.get(boardId);
    if (board) {
      return {
        id: boardId,
        name: board.name,
        cards: board.cards,
      };
    }
    return undefined;
  }

  /**
   * Add board (compatibility method)
   */
  async addBoard(
    boardId: string,
    name: string,
  ): Promise<{ id: string; name: string; cards: Record<string, CardData> }> {
    this.logger.info("Adding board to workspace proxy", { boardId, name });

    const board = { name, cards: {} };
    this.boards.set(boardId, board);

    return {
      id: boardId,
      name,
      cards: {},
    };
  }

  /**
   * Get card by miro link (compatibility method)
   */
  getCardByLink(miroLink: string): CardData | undefined {
    return this.get(miroLink);
  }

  /**
   * List all cards (compatibility method)
   */
  listAllCards(): CardData[] {
    const allCards: CardData[] = [];
    for (const board of this.boards.values()) {
      allCards.push(
        ...Object.values((board as any).cards as Record<string, CardData>),
      );
    }
    return allCards;
  }

  /**
   * List workspace boards (compatibility method)
   */
  listWorkspaceBoards(): string[] {
    // For now, return all boards - in future this could be filtered by workspace assignment
    return this.listBoardIds();
  }

  /**
   * Set workspace boards (compatibility method)
   */
  setWorkspaceBoards(boardIds: string[]): void {
    this.logger.debug("Setting workspace boards", { boardIds });
    // For now, this is a no-op since the proxy manages boards differently
    // In future, this could filter which boards are visible to this workspace

    // Emit event for compatibility
    this.emit("workspaceBoards", { type: "workspaceBoards", boardIds });
  }

  /**
   * Clear all data (compatibility method)
   */
  clear(): void {
    this.logger.info("Clearing all workspace proxy data");
    this.boards.clear();
    // Note: We don't clear sockets as they represent active connections
  }

  /**
   * Override set method to emit events for compatibility
   */
  set(miroLink: string, card: CardData): void {
    // Extract board ID from miro link
    try {
      const url = new URL(miroLink);
      const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
      if (match) {
        const boardId = match[1];
        let board = this.boards.get(boardId);
        if (!board) {
          board = { name: "", cards: {} };
          this.boards.set(boardId, board);
        }

        board.cards[miroLink] = card;

        this.logger.debug("Card set in local cache", {
          boardId,
          miroLink,
          title: card.title,
        });

        // Only emit events if not initializing to prevent circular references
        if (!this.isInitializing) {
          this.emit("cardUpdate", { type: "cardUpdate", miroLink, card });
        }
      }
    } catch (error) {
      this.logger.error("Failed to set card - invalid miro link", {
        miroLink,
        error,
      });
    }
  }

  /**
   * Universal query method that matches MiroServer.query() signature
   * Routes all query operations through workspace client when available
   */
  async query(
    boardId: string,
    queryName: string,
    ...args: any[]
  ): Promise<any> {
    // Enhanced logging for all query operations
    this.logger.info("🔄 PROXY QUERY: Starting query operation", {
      timestamp: new Date().toISOString(),
      boardId,
      queryName,
      argsCount: args.length,
      isProxyEnabled: this.isProxyEnabled(),
      hasWorkspaceClient: !!this.workspaceClient,
      direction: "proxy->server",
    });

    if (this.isProxyEnabled() && this.workspaceClient) {
      this.logger.info("🚀 Using workspace client proxy for query", {
        timestamp: new Date().toISOString(),
        boardId,
        queryName,
        args: args.map((arg, i) => ({ index: i, type: typeof arg })),
      });

      try {
        const startTime = Date.now();
        const result = await this.workspaceClient.proxyQuery(
          boardId,
          queryName as any,
          ...args,
        );
        const duration = Date.now() - startTime;

        this.logger.info("✅ Query executed successfully via proxy", {
          timestamp: new Date().toISOString(),
          boardId,
          queryName,
          duration: `${duration}ms`,
          resultType: typeof result,
          hasResult: result !== undefined,
        });
        return result;
      } catch (error) {
        this.logger.error("❌ Failed to execute query via proxy", {
          timestamp: new Date().toISOString(),
          boardId,
          queryName,
          args: args.map((arg, i) => ({ index: i, type: typeof arg })),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } else {
      // Fallback to direct socket operation
      this.logger.info("⚠️ Using direct socket fallback for query", {
        timestamp: new Date().toISOString(),
        boardId,
        queryName,
        reason: this.isProxyEnabled()
          ? "no-workspace-client"
          : "proxy-disabled",
      });

      const socket = this.getBoardSocket(boardId);
      if (!socket) {
        this.logger.error("❌ No socket connection to board", {
          timestamp: new Date().toISOString(),
          boardId,
          queryName,
        });
        throw new Error(`No connection to board ${boardId}`);
      }

      this.logger.debug("📡 Executing query via direct socket", {
        timestamp: new Date().toISOString(),
        boardId,
        queryName,
        argsCount: args.length,
      });

      // Use direct socket query (existing implementation)
      const requestId = Math.random().toString(36);
      const startTime = Date.now();

      return new Promise<any>((resolve, reject) => {
        socket.emit("query", {
          name: queryName,
          requestId,
          data: args,
        });

        socket.once(`queryResult-${requestId}`, (response: any) => {
          const duration = Date.now() - startTime;

          if (response.error) {
            this.logger.error("❌ Direct socket query failed", {
              timestamp: new Date().toISOString(),
              boardId,
              queryName,
              requestId,
              duration: `${duration}ms`,
              error: response.error,
            });
            reject(new Error(response.error));
          } else {
            this.logger.info("✅ Direct socket query successful", {
              timestamp: new Date().toISOString(),
              boardId,
              queryName,
              requestId,
              duration: `${duration}ms`,
              resultType: typeof response.response,
            });
            resolve(response.response);
          }
        });

        // Add timeout handling
        setTimeout(() => {
          const duration = Date.now() - startTime;
          this.logger.error("⏰ Direct socket query timeout", {
            timestamp: new Date().toISOString(),
            boardId,
            queryName,
            requestId,
            duration: `${duration}ms`,
            timeout: "10000ms",
          });
          reject(new Error(`${queryName} query timeout`));
        }, 10000);
      });
    }
  }

  /**
   * Get proxy statistics
   */
  getProxyStats(): {
    boardCount: number;
    totalCards: number;
    isProxyEnabled: boolean;
    workspaceClientStats?: any;
  } {
    const totalCards = Array.from(this.boards.values()).reduce(
      (sum: number, board: any) => sum + Object.keys(board.cards).length,
      0,
    );

    return {
      boardCount: this.boards.size,
      totalCards,
      isProxyEnabled: this.isProxyEnabled(),
      workspaceClientStats: this.workspaceClient?.getQueryProxyStats(),
    };
  }
}
