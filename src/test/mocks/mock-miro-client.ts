import createDebugger from "debug";
import { EventEmitter } from "events";
import { Socket, io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import {
  AppExplorerTag,
  CardData,
  MiroToWorkspaceOperations,
  SymbolCardData,
  WorkspaceToMiroOperations,
} from "../../EventTypes";
import { CardStorage, MemoryAdapter } from "../../card-storage";

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
  private boardName: string;
  private cardStorage: CardStorage;
  private serverUrl: string;
  private selectedCards: CardData[] = [];

  constructor(serverUrl: string = "http://localhost:9042") {
    super();
    this.boardId = "mock-board-test-123";
    this.boardName = "Mock Test Board";
    const adapter = new MemoryAdapter();
    this.cardStorage = new CardStorage(adapter);
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
          name: this.cardStorage.getBoard(this.boardId)?.name,
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

    // Wait a bit longer to ensure the server has finished setting up event handlers
    // for this socket after the board connection is established
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send navigateTo event using the same format as real Miro boards
    this.socketEmit("navigateTo", card);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  socketEmit(event: keyof MiroToWorkspaceOperations, data: any) {
    this.socket?.emit(event, data);
    debug("Sent %s event to server %O", event, {
      data,
    });
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
        this.socketEmit("card", {
          url: card.miroLink,
          card: card,
        });
      }
    });

    this.socketEmit("selectedCards", cards);
    this.selectedCards = cards;
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
      this.socketEmit("card", {
        url: card.miroLink,
        card: card,
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

    const queryHandlers: WorkspaceToMiroOperations = {
      cardStatus: async (_routedBoardId, dataCard, done) => {
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
        await this.cardStorage.setCard(this.boardId, card);
        done(true); // Call the callback to indicate success
      },
      newCards: async (_routedBoardId, data, _options, done) => {
        const cards = data.map((card) => ({
          ...card,
          miroLink: `https://miro.com/app/board/${this.boardId}/?moveToWidget=${Math.random().toString(36)}`,
        }));

        debug("newCards", cards);
        await Promise.all(
          cards.map((card: CardData) =>
            this.cardStorage.setCard(this.boardId, card),
          ),
        );
        done(true); // Indicate success
      },
      getBoardInfo: async (_routedBoardId, done) => {
        const boardInfo = this.cardStorage.getBoard(this.boardId)!;
        queryHandlers.cards(_routedBoardId, (cards) => {
          done({
            boardId: boardInfo.boardId,
            name: boardInfo.name,
            cards: cards.reduce(
              (acc, c) => {
                acc[c.miroLink!] = c;
                return acc;
              },
              {} as Record<string, CardData>,
            ),
          });
        });
      },
      cards: async (_routedBoardId, done) => {
        done(this.cardStorage.listAllCards());
      },
      selected: async (_routedBoardId, done) => {
        done(this.selectedCards);
      },
      selectCard: async (
        _routedBoardId,
        miroLink: string,
      ): Promise<boolean> => {
        const cards = this.cardStorage.listAllCards().filter((card) => {
          return card.miroLink === miroLink;
        });
        this.sendSelectionUpdateEvent(cards);
        return true;
      },
      getIdToken: async (_routedBoardId): Promise<string> => {
        return "mock-token";
      },
      setBoardName: async (_routedBoardId, name: string): Promise<void> => {
        this.boardName = name;
        this.cardStorage.setBoardName(this.boardId, name);
      },
      tags: async (_routedBoardId): Promise<AppExplorerTag[]> => {
        // Tags only exist in Miro, nothing needs to be done where
        return [];
      },
      attachCard: async (
        _routedBoardId,
        data: CardData,
        done,
      ): Promise<void> => {
        this.cardStorage.setCard(this.boardId, data);
        done(true);
      },
      tagCards: async (_routedBoardId, _data): Promise<void> => {
        // Right now tags only exist within Miro, they aren't part of the card
        // data.
      },
      hoverCard: async (_routedBoardId, _miroLink: string): Promise<void> => {
        // This visually positions the cards in the middle of the screen. There
        // is nothing to do in the mock.
      },
    };
    Object.keys(queryHandlers).forEach((key) => {
      const query = key as keyof typeof queryHandlers;
      this.socket?.on(query, queryHandlers[query]);
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
