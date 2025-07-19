import { EventEmitter } from "events";
import type { Socket } from "socket.io";
import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";

// Server-side board info with additional server-specific metadata
export interface ServerBoardInfo {
  id: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
  connectedAt: Date;
  lastActivity: Date;
  assignedWorkspaces: string[]; // Workspace IDs that should receive events for this board
}

// Events emitted by ServerCardStorage
export type ServerCardStorageEvents = {
  boardUpdate: {
    type: "boardUpdate";
    board: ServerBoardInfo | null;
    boardId: string;
  };
  cardUpdate: {
    type: "cardUpdate";
    card: CardData | null;
    miroLink: string;
    boardId: string;
  };
  connectedBoards: { type: "connectedBoards"; boards: string[] };
  workspaceBoards: { type: "workspaceBoards"; boardIds: string[] };
};

/**
 * Server-side memory-backed CardStorage for managing board and card data
 * across multiple workspace connections. Only active when enableDualStorage flag is enabled.
 */
export class ServerCardStorage
  extends EventEmitter
  implements vscode.Disposable
{
  private boards = new Map<string, ServerBoardInfo>();
  private sockets = new Map<string, Socket>(); // boardId -> Miro board socket
  private connectedBoards = new Set<string>();
  private logger = createLogger("server-card-storage");

  constructor(private featureFlagManager: FeatureFlagManager) {
    super();
    this.logger.debug("ServerCardStorage initialized");
  }

  dispose(): void {
    this.removeAllListeners();
    this.boards.clear();
    this.sockets.clear();
    this.connectedBoards.clear();
    this.logger.debug("ServerCardStorage disposed");
  }

  /**
   * Check if dual storage is enabled
   */
  private isDualStorageEnabled(): boolean {
    return this.featureFlagManager.isEnabled("enableDualStorage");
  }

  /**
   * Get list of connected board IDs
   */
  getConnectedBoards(): string[] {
    if (!this.isDualStorageEnabled()) {
      return [];
    }
    return Array.from(this.connectedBoards);
  }

  /**
   * Connect a Miro board socket to the server storage
   */
  async connectBoard(boardId: string, socket: Socket): Promise<void> {
    if (!this.isDualStorageEnabled()) {
      this.logger.debug("Dual storage disabled, skipping board connection", {
        boardId,
      });
      return;
    }

    this.logger.info("Connecting board to server storage", { boardId });

    this.sockets.set(boardId, socket);
    this.connectedBoards.add(boardId);

    // Update board metadata
    const board = this.boards.get(boardId);
    if (board) {
      board.lastActivity = new Date();
    }

    this.emit("connectedBoards", {
      type: "connectedBoards",
      boards: this.getConnectedBoards(),
    });

    socket.once("disconnect", () => {
      this.logger.info("Board disconnected from server storage", { boardId });
      this.sockets.delete(boardId);
      this.connectedBoards.delete(boardId);
      this.emit("connectedBoards", {
        type: "connectedBoards",
        boards: this.getConnectedBoards(),
      });
    });
  }

  /**
   * Get Miro board socket for a specific board
   */
  getBoardSocket(boardId: string): Socket | undefined {
    if (!this.isDualStorageEnabled()) {
      return undefined;
    }
    return this.sockets.get(boardId);
  }

  /**
   * Add a new board to server storage
   */
  async addBoard(
    boardId: string,
    name: string,
    assignedWorkspaces: string[] = [],
  ): Promise<ServerBoardInfo> {
    if (!this.isDualStorageEnabled()) {
      throw new Error("Dual storage is disabled");
    }

    this.logger.info("Adding board to server storage", {
      boardId,
      name,
      assignedWorkspaces,
    });

    const board: ServerBoardInfo = {
      id: boardId,
      name,
      cards: {},
      connectedAt: new Date(),
      lastActivity: new Date(),
      assignedWorkspaces,
    };

    this.boards.set(boardId, board);
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });

    return board;
  }

  /**
   * Get board information
   */
  getBoard(boardId: string): ServerBoardInfo | undefined {
    if (!this.isDualStorageEnabled()) {
      return undefined;
    }
    return this.boards.get(boardId);
  }

  /**
   * Set board name
   */
  setBoardName(boardId: string, name: string): ServerBoardInfo | undefined {
    if (!this.isDualStorageEnabled()) {
      return undefined;
    }

    const board = this.boards.get(boardId);
    if (board) {
      this.logger.debug("Updating board name", {
        boardId,
        oldName: board.name,
        newName: name,
      });
      board.name = name;
      board.lastActivity = new Date();
      this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    }
    return board;
  }

  /**
   * Set all cards for a board (replaces existing cards)
   */
  setBoardCards(boardId: string, cards: CardData[]): void {
    if (!this.isDualStorageEnabled()) {
      return;
    }

    const board = this.boards.get(boardId);
    if (!board) {
      this.logger.warn("Cannot set cards - board not found", {
        boardId,
        cardCount: cards.length,
        availableBoards: Array.from(this.boards.keys()),
      });
      return;
    }

    const startTime = Date.now();
    const previousCardCount = Object.keys(board.cards).length;

    this.logger.debug("Setting board cards", {
      boardId,
      newCardCount: cards.length,
      previousCardCount,
    });

    try {
      let validCards = 0;
      let invalidCards = 0;

      board.cards = cards.reduce(
        (acc, card) => {
          if (card.miroLink) {
            acc[card.miroLink] = card;
            validCards++;
          } else {
            invalidCards++;
          }
          return acc;
        },
        {} as Record<string, CardData>,
      );

      board.lastActivity = new Date();
      const duration = Date.now() - startTime;

      this.logger.info("Board cards updated successfully", {
        boardId,
        validCards,
        invalidCards,
        totalCards: cards.length,
        duration: `${duration}ms`,
      });

      this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Error setting board cards", {
        boardId,
        cardCount: cards.length,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Set/update a single card
   */
  async setCard(boardId: string, card: CardData): Promise<void> {
    if (!this.isDualStorageEnabled() || !card.miroLink) {
      return;
    }

    const board = this.boards.get(boardId);
    if (board) {
      this.logger.debug("Setting card", {
        boardId,
        miroLink: card.miroLink,
        title: card.title,
      });

      board.cards[card.miroLink] = card;
      board.lastActivity = new Date();

      this.emit("cardUpdate", {
        type: "cardUpdate",
        card,
        miroLink: card.miroLink,
        boardId,
      });
    }
  }

  /**
   * Set card by miro link (alternative interface)
   */
  set(miroLink: string, card: CardData): void {
    if (!this.isDualStorageEnabled()) {
      return;
    }

    try {
      // Extract board ID from miro link
      const url = new URL(miroLink);
      const match = url.pathname.match(/\/app\/board\/([^/]+)\//);

      if (match) {
        const boardId = match[1];
        const board = this.boards.get(boardId);

        if (board) {
          this.logger.debug("Setting card by miro link", {
            boardId,
            miroLink,
            title: card.title,
          });

          board.cards[miroLink] = card;
          board.lastActivity = new Date();

          this.emit("cardUpdate", {
            type: "cardUpdate",
            card,
            miroLink,
            boardId,
          });
        } else {
          this.logger.warn("Board not found for miro link", {
            boardId,
            miroLink,
            availableBoards: Array.from(this.boards.keys()),
          });
        }
      } else {
        this.logger.warn("Could not extract board ID from miro link", {
          miroLink,
          pathname: url.pathname,
        });
      }
    } catch (error) {
      this.logger.error("Error parsing miro link", {
        miroLink,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get card by miro link
   */
  getCardByLink(link: string): CardData | undefined {
    if (!this.isDualStorageEnabled()) {
      return undefined;
    }

    return [...this.boards.values()]
      .flatMap((board) => Object.values(board.cards))
      .find((card) => card.miroLink === link);
  }

  /**
   * Delete card by miro link
   */
  deleteCardByLink(link: string): void {
    if (!this.isDualStorageEnabled()) {
      return;
    }

    this.logger.debug("Deleting card by link", { miroLink: link });

    [...this.boards.values()].forEach((board) => {
      if (board.cards[link]) {
        delete board.cards[link];
        board.lastActivity = new Date();

        this.emit("cardUpdate", {
          type: "cardUpdate",
          miroLink: link,
          card: null,
          boardId: board.id,
        });
      }
    });
  }

  /**
   * Get total number of cards across all boards
   */
  totalCards(): number {
    if (!this.isDualStorageEnabled()) {
      return 0;
    }

    return [...this.boards.values()].reduce(
      (acc, board) => acc + Object.keys(board.cards).length,
      0,
    );
  }

  /**
   * List all board IDs
   */
  listBoardIds(): string[] {
    if (!this.isDualStorageEnabled()) {
      return [];
    }
    return [...this.boards.keys()];
  }

  /**
   * List all cards across all boards
   */
  listAllCards(): CardData[] {
    if (!this.isDualStorageEnabled()) {
      return [];
    }
    return [...this.boards.values()].flatMap((board) =>
      Object.values(board.cards),
    );
  }

  /**
   * Assign workspaces to a board
   */
  assignWorkspacesToBoard(boardId: string, workspaceIds: string[]): void {
    if (!this.isDualStorageEnabled()) {
      return;
    }

    const board = this.boards.get(boardId);
    if (board) {
      this.logger.debug("Assigning workspaces to board", {
        boardId,
        workspaceIds,
      });
      board.assignedWorkspaces = workspaceIds;
      board.lastActivity = new Date();
      this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    }
  }

  /**
   * Get workspaces assigned to a board
   */
  getBoardWorkspaces(boardId: string): string[] {
    if (!this.isDualStorageEnabled()) {
      return [];
    }

    const board = this.boards.get(boardId);
    return board ? board.assignedWorkspaces : [];
  }

  /**
   * Clear all data (for testing/cleanup)
   */
  clear(): void {
    if (!this.isDualStorageEnabled()) {
      return;
    }

    this.logger.info("Clearing all server storage data");

    this.listBoardIds().forEach((boardId) => {
      this.emit("boardUpdate", {
        type: "boardUpdate",
        board: null,
        boardId,
      });
    });

    this.boards.clear();
    this.connectedBoards.clear();
    this.sockets.clear();
  }

  /**
   * Get server storage statistics
   */
  getStats(): {
    boardCount: number;
    cardCount: number;
    connectedBoardCount: number;
    isEnabled: boolean;
  } {
    return {
      boardCount: this.boards.size,
      cardCount: this.totalCards(),
      connectedBoardCount: this.connectedBoards.size,
      isEnabled: this.isDualStorageEnabled(),
    };
  }
}
