import createDebugger from "debug";
import { EventEmitter } from "events";
import { Socket, io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import { CardData, SymbolCardData } from "../../EventTypes";
import { CardStorage, createMemoryCardStorage } from "../../card-storage";
import { waitForValue } from "../suite/test-utils";

const debug = createDebugger("app-explorer:test:mock-miro-client");

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
  private cardStorage: CardStorage;
  private serverUrl: string;
  private initialized = false;

  constructor(serverUrl: string = "http://localhost:9042") {
    super();
    this.boardId = "mock-board-test-123";
    this.boardName = "Mock Test Board";
    this.cardStorage = createMemoryCardStorage();
    this.cardStorage.addBoard(this.boardId, this.boardName);
    this.serverUrl = serverUrl;
  }

  /**
   * Connect to the local AppExplorer server
   * Mimics the connection behavior of real Miro boards
   */
  async connect(): Promise<void> {
    try {
      debug("Connecting to AppExplorer server", {
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
        debug("Connected to AppExplorer server", {
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
        debug("Disconnected from AppExplorer server", {
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
        console.error("Connection error", {
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

      await waitForValue(() => (this.initialized ? true : undefined));
    } catch (error) {
      console.error("Failed to connect to server", {
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
  async loadTestCards(cards: CardData[]): Promise<void> {
    const cardPromises = cards
      .map((card) => ({
        ...card,
        boardId: this.boardId, // Ensure all cards use the mock board ID
      }))
      .map((card) => {
        return this.setCard(card);
      });

    await Promise.all(cardPromises);

    debug("Loaded test cards", {
      cardCount: cards.length,
      boardId: this.boardId,
    });
  }

  /**
   * Get the loaded test cards
   */
  getTestCards(): CardData[] {
    return this.cardStorage.listAllCards();
  }

  setCard(card: CardData): Promise<void> {
    return this.cardStorage.setCard(this.boardId, card);
  }

  /**
   * Send navigateTo event to the server (same as src/miro.ts line 439)
   */
  async sendNavigateToEvent(card: CardData): Promise<void> {
    if (!this.socket?.connected) {
      const errorMsg = "MockMiroClient: Not connected to server";
      vscode.window.showErrorMessage(errorMsg);
      console.error(errorMsg, { boardId: this.boardId });
      return;
    }
    const storedCard = this.cardStorage.getCardByLink(card.miroLink!);
    if (!storedCard) {
      throw new Error(`Card not found in storage: ${card.miroLink}`);
    }

    // Send navigateTo event using the same format as real Miro boards
    this.socket.emit("navigateTo", card);

    debug("Sent navigateTo event to server", {
      event: "navigateTo",
      card: {
        title: card.title,
        path: card.path,
        symbol: isSymbolCard(card) ? card.symbol : undefined,
        miroLink: card.miroLink,
      },
      boardId: this.boardId,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Send card selection events to the server (same as src/miro.ts line 488)
   */
  sendSelectionUpdateEvent(cards: CardData[]): void {
    if (!this.socket?.connected) {
      const errorMsg = "MockMiroClient: Not connected to server";
      vscode.window.showErrorMessage(errorMsg);
      console.error(errorMsg, { boardId: this.boardId });
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

    debug("Sent card selection events to server", {
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
      console.error(errorMsg, { boardId: this.boardId });
      return;
    }

    if (card.miroLink) {
      this.socket.emit("card", {
        url: card.miroLink,
        card: card,
      });

      debug("Sent card update event to server", {
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
      debug("Received query command from VSCode", {
        queryName: name,
        requestId,
        data,
        boardId: this.boardId,
      });

      try {
        // Mock implementation of common queries
        let response: any;
        switch (name) {
          case "cardStatus":
            const [dataCard] = data;

            const card = this.cardStorage.getCardByLink(dataCard.miroLink);
            if (!card) {
              throw new Error("Card not found");
            }
            card.status = dataCard.status;
            if (isSymbolCard(card) && dataCard.codeLink) {
              card.codeLink = dataCard.codeLink;
            }
            if (!card.miroLink) {
              throw new Error("Card missing miroLink");
            }
            this.cardStorage.setCard(this.boardId, card);

            response = undefined;
            break;
          case "newCards":
            response = (data[0] as CardData[])
              .map((card) => ({
                ...card,
                miroLink: `https://miro.com/app/board/${this.boardId}/?moveToWidget=${Math.random().toString(36)}`,
              }))
              .filter((c) => c.type);

            debug("newCards", data[0]);
            await Promise.all(
              response.map((card: CardData) =>
                this.cardStorage.setCard(this.boardId, card),
              ),
            );

            break;
          case "getBoardInfo":
            response = { name: this.boardName, boardId: this.boardId };
            break;
          case "cards":
            response = this.cardStorage.listAllCards();
            this.initialized = true;
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
        console.error("Error handling query command", {
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

  /**
   * Get board ID
   */
  getBoardId(): string {
    return this.boardId;
  }
}
