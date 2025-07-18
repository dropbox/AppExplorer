import { EventEmitter } from "events";
import { Socket, io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import { CardData, SymbolCardData } from "../../EventTypes";
import { CardStorage, createMemoryCardStorage } from "../../card-storage";
import { createLogger } from "../../logger";

/**
 * Type guard to check if a card is a symbol card
 */
function isSymbolCard(card: CardData): card is SymbolCardData {
  return card.type === "symbol";
}

export interface MockMiroClientEvents {
  connected: [];
  disconnected: [];
  cardStatusUpdate: [any];
  cardSelection: [CardData[]];
  error: [{ message: string; code?: string }];
}

export class MockMiroClient extends EventEmitter<MockMiroClientEvents> {
  private socket?: Socket;
  private readonly boardId: string;
  private readonly boardName: string;
  private testCards: CardData[] = [];
  private cardStorage: CardStorage;
  private logger = createLogger("mock-miro-client");
  private serverUrl: string;

  constructor(serverUrl: string = "http://localhost:9042") {
    super();
    this.boardId = "mock-board-test-123";
    this.boardName = "Mock Test Board";
    this.cardStorage = createMemoryCardStorage();
    this.serverUrl = serverUrl;
  }

  /**
   * Connect to the local AppExplorer server
   * Mimics the connection behavior of real Miro boards
   */
  async connect(): Promise<void> {
    try {
      this.logger.info("Connecting to AppExplorer server", {
        serverUrl: this.serverUrl,
        boardId: this.boardId,
      });

      // Connect using socket.io-client (same as real Miro boards)
      this.socket = socketIO(this.serverUrl, {
        transports: ["websocket"],
        timeout: 10000,
        reconnection: false,
        forceNew: true,
      });

      // Set up connection event handlers
      this.socket.on("connect", () => {
        this.logger.info("Connected to AppExplorer server", {
          socketId: this.socket?.id,
          boardId: this.boardId,
        });

        // Emit board connection event (similar to real Miro boards)
        this.socket?.emit("boardConnect", {
          id: this.boardId,
          name: this.boardName,
        });

        // Set VSCode context to enable MockMiro commands
        vscode.commands.executeCommand(
          "setContext",
          "mockMiroClient.connected",
          true,
        );

        this.emit("connected");
      });

      this.socket.on("disconnect", (reason) => {
        this.logger.info("Disconnected from AppExplorer server", {
          reason,
          boardId: this.boardId,
        });

        // Disable MockMiro commands when disconnected
        vscode.commands.executeCommand(
          "setContext",
          "mockMiroClient.connected",
          false,
        );

        this.emit("disconnected");
      });

      this.socket.on("connect_error", (error) => {
        this.logger.error("Connection error", {
          error: error.message,
          boardId: this.boardId,
        });
        this.emit("error", {
          message: `Failed to connect to server: ${error.message}`,
          code: "CONNECTION_ERROR",
        });
      });

      // Set up handlers for commands from VSCode
      this.setupCommandHandlers();

      // Wait for connection to be established
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 10000);

        this.socket?.on("connect", () => {
          clearTimeout(timeout);
          resolve();
        });

        this.socket?.on("connect_error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error("Failed to connect to server", {
        error: error instanceof Error ? error.message : String(error),
        boardId: this.boardId,
      });
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket?.connected) {
      this.socket.disconnect();
    }

    // Ensure context is cleared even if socket wasn't connected
    vscode.commands.executeCommand(
      "setContext",
      "mockMiroClient.connected",
      false,
    );
  }

  /**
   * Load predefined test card fixtures
   */
  loadTestCards(cards: CardData[]): void {
    this.testCards = cards.map((card) => ({
      ...card,
      boardId: this.boardId, // Ensure all cards use the mock board ID
    }));

    // Store cards in the in-memory storage
    this.testCards.forEach((card) => {
      if (card.miroLink) {
        this.cardStorage.setCard(card.miroLink, card);
      }
    });

    this.logger.info("Loaded test cards", {
      cardCount: this.testCards.length,
      boardId: this.boardId,
    });
  }

  /**
   * Get the loaded test cards
   */
  getTestCards(): CardData[] {
    return [...this.testCards];
  }

  /**
   * Send navigateTo event to the server (same as src/miro.ts line 439)
   */
  sendNavigateToEvent(card: CardData): void {
    if (!this.socket?.connected) {
      const errorMsg = "MockMiroClient: Not connected to server";
      vscode.window.showErrorMessage(errorMsg);
      this.logger.error(errorMsg, { boardId: this.boardId });
      return;
    }

    // Send navigateTo event using the same format as real Miro boards
    this.socket.emit("navigateTo", card);

    this.logger.info("Sent navigateTo event to server", {
      event: "navigateTo",
      card: {
        title: card.title,
        path: card.path,
        symbol: isSymbolCard(card) ? card.symbol : undefined,
        miroLink: card.miroLink,
      },
      boardId: this.boardId,
    });
  }

  /**
   * Send card selection events to the server (same as src/miro.ts line 488)
   */
  sendSelectionUpdateEvent(cards: CardData[]): void {
    if (!this.socket?.connected) {
      const errorMsg = "MockMiroClient: Not connected to server";
      vscode.window.showErrorMessage(errorMsg);
      this.logger.error(errorMsg, { boardId: this.boardId });
      return;
    }

    // Send card events for each selected card (same format as real Miro)
    cards.forEach((card) => {
      if (card.miroLink) {
        this.socket?.emit("card", {
          url: card.miroLink,
          card: card,
        });
      }
    });

    this.logger.info("Sent card selection events to server", {
      event: "card",
      cardCount: cards.length,
      boardId: this.boardId,
    });

    this.emit("cardSelection", cards);
  }

  /**
   * Send card update event to the server
   */
  sendCardUpdateEvent(card: CardData): void {
    if (!this.socket?.connected) {
      const errorMsg = "MockMiroClient: Not connected to server";
      vscode.window.showErrorMessage(errorMsg);
      this.logger.error(errorMsg, { boardId: this.boardId });
      return;
    }

    if (card.miroLink) {
      this.socket.emit("card", {
        url: card.miroLink,
        card: card,
      });

      this.logger.info("Sent card update event to server", {
        event: "card",
        cardTitle: card.title,
        miroLink: card.miroLink,
        boardId: this.boardId,
      });
    }
  }

  /**
   * Set up handlers for commands received from VSCode
   * This allows the MockMiroClient to respond to VSCode commands like real Miro boards
   */
  private setupCommandHandlers(): void {
    if (!this.socket) {
      return;
    }

    // Handle query commands from VSCode
    this.socket.on("query", async ({ name, requestId, data }) => {
      this.logger.info("Received query command from VSCode", {
        queryName: name,
        requestId,
        data,
        boardId: this.boardId,
      });

      try {
        // Mock implementation of common queries
        let response: any;
        switch (name) {
          case "getBoardInfo":
            response = { name: this.boardName, boardId: this.boardId };
            break;
          case "cards":
            response = this.testCards;
            break;
          case "selected":
            response = []; // Mock empty selection
            break;
          default:
            response = null;
        }

        this.socket?.emit("queryResult", {
          name,
          requestId,
          response,
        });

        this.emit("cardStatusUpdate", { name, requestId, response });
      } catch (error) {
        this.logger.error("Error handling query command", {
          queryName: name,
          requestId,
          error: error instanceof Error ? error.message : String(error),
          boardId: this.boardId,
        });
      }
    });
  }

  /**
   * Get connection status
   */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Get board information
   */
  get boardInfo() {
    return {
      id: this.boardId,
      name: this.boardName,
    };
  }
}
