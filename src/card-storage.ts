import { EventEmitter } from "events";
import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { MiroServerSocket } from "./server";

// Storage adapter interface to abstract persistence layer
export interface StorageAdapter {
  get<T>(key: string): T | undefined;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
}

// VSCode adapter that uses ExtensionContext.workspaceState
export class VSCodeAdapter implements StorageAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  get<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  async set(key: string, value: any): Promise<void> {
    await this.context.workspaceState.update(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.context.workspaceState.update(key, undefined);
  }

  addToSubscriptions(disposable: vscode.Disposable): void {
    this.context.subscriptions.push(disposable);
  }
}

// Memory adapter that uses Map for in-memory storage
export class MemoryAdapter implements StorageAdapter {
  private storage = new Map<string, any>();

  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  async set(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }
}

export type BoardInfo = {
  boardId: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
};

type StorageEvent = {
  workspaceBoards: [{ type: "workspaceBoards"; boardIds: string[] }];
  boardUpdate: [
    {
      type: "boardUpdate";
      board: BoardInfo | null;
      boardId: BoardInfo["boardId"];
    },
  ];
  connectedBoards: [{ type: "connectedBoards"; boardIds: string[] }];
  cardUpdate: [
    {
      type: "cardUpdate";
      miroLink: NonNullable<CardData["miroLink"]>;
      card: CardData | null;
    },
  ];
  selectedCards: [CardData[]];
};

export class CardStorage
  extends EventEmitter<StorageEvent>
  implements vscode.Disposable
{
  private boards = new Map<BoardInfo["boardId"], BoardInfo>();
  private sockets = new Map<string, MiroServerSocket>();
  protected connectedBoardIds = new Set<string>();
  private selectedIds: string[] = [];

  constructor(private storage: StorageAdapter) {
    super();
    const boardIds = this.storage.get<string[]>("boardIds");

    boardIds?.forEach((id) => {
      const board = this.storage.get<BoardInfo>(`board-${id}`);
      if (board) {
        this.boards.set(board.boardId, board);
      }
    });
  }

  dispose(): void {
    this.removeAllListeners();
  }

  getConnectedBoards() {
    return Array.from(this.connectedBoardIds);
  }

  async disconnectBoard(boardId: string) {
    this.sockets.delete(boardId);
    this.connectedBoardIds.delete(boardId);
    this.emit("connectedBoards", {
      type: "connectedBoards",
      boardIds: this.getConnectedBoards(),
    });
  }

  async connectBoard(boardId: string, socket: MiroServerSocket) {
    this.sockets.set(boardId, socket);
    this.connectedBoardIds.add(boardId);
    this.emit("connectedBoards", {
      type: "connectedBoards",
      boardIds: this.getConnectedBoards(),
    });

    socket.on("disconnect", () => {
      this.disconnectBoard(boardId);
    });
  }

  getBoardSocket(boardId: string) {
    return this.sockets.get(boardId);
  }

  async addBoard(boardId: string, name: string) {
    const board: BoardInfo = { boardId: boardId, name, cards: {} };
    this.boards.set(boardId, board);
    const boardIds = this.storage.get<string[]>("boardIds") || [];
    boardIds.push(boardId);
    await this.storage.set("boardIds", boardIds);
    await this.storage.set(`board-${boardId}`, board);
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    return board;
  }

  async setCard(boardId: string, card: CardData) {
    const board = this.boards.get(boardId);
    if (board) {
      board.cards[card.miroLink!] = card;
      await this.storage.set(`board-${boardId}`, board);
      this.emit("cardUpdate", {
        type: "cardUpdate",
        card,
        miroLink: card.miroLink!,
      });
    } else {
      throw new Error(`Board not found: ${boardId}`);
    }
  }

  getBoard(boardId: string) {
    return this.boards.get(boardId);
  }

  setBoardName(boardId: string, name: string) {
    const board = this.boards.get(boardId);
    if (board) {
      board.name = name;
      this.storage.set(`board-${boardId}`, board);
      this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    }
    return board;
  }

  setBoardCards(boardId: string, cards: CardData[]) {
    const board = this.boards.get(boardId);
    if (board) {
      board.cards = cards.reduce(
        (acc, c) => {
          acc[c.miroLink!] = c;
          return acc;
        },
        {} as Record<string, CardData>,
      );
      this.storage.set(`board-${boardId}`, board);
      this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    }
  }

  totalCards() {
    return [...this.boards.values()].reduce(
      (acc, b) => acc + Object.keys(b.cards).length,
      0,
    );
  }

  getCardByLink(link: string): CardData | undefined {
    return [...this.boards.values()]
      .flatMap((b) => Object.values(b.cards))
      .find((c) => c.miroLink === link);
  }

  deleteCardByLink(link: string) {
    [...this.boards.values()].forEach((b) => {
      if (b.cards[link]) {
        delete b.cards[link];
        this.storage.set(`board-${b.boardId}`, b);
        this.emit("cardUpdate", {
          type: "cardUpdate",
          miroLink: link,
          card: null,
        });
      }
    });
  }

  clear() {
    this.listBoardIds().forEach((boardId) => {
      this.storage.delete(`board-${boardId}`);
      this.emit("boardUpdate", {
        type: "boardUpdate",
        board: null,
        boardId: boardId,
      });
    });
    this.boards.clear();
    this.storage.set("boardIds", []);
  }

  set(miroLink: string, card: CardData) {
    const url = new URL(miroLink);
    const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
    if (match) {
      const boardId = match[1];
      const board = this.boards.get(boardId);
      if (board) {
        board.cards[miroLink] = card;
        this.storage.set(`board-${boardId}`, board);
        this.emit("cardUpdate", { type: "cardUpdate", miroLink, card });
      }
    }
  }

  setWorkspaceBoards(boardIds: string[]) {
    if (this.listBoardIds().length === boardIds.length) {
      this.storage.delete(`board-filter`);
    } else {
      this.storage.set(`board-filter`, boardIds);
    }
    this.emit("workspaceBoards", { type: "workspaceBoards", boardIds });
  }
  listBoardIds() {
    return [...this.boards.keys()];
  }
  listAllCards() {
    return [...this.boards.values()].flatMap((b) => Object.values(b.cards));
  }

  selectedCards(data: CardData[]) {
    this.selectedIds = data.map((c) => c.miroLink!);
    this.emit("selectedCards", data);
  }

  getSelectedCardIDs(): string[] {
    return this.selectedIds;
  }
}

// Factory functions for creating CardStorage with different adapters
export function createVSCodeCardStorage(
  context: vscode.ExtensionContext,
): CardStorage {
  const adapter = new VSCodeAdapter(context);
  const storage = new CardStorage(adapter);
  adapter.addToSubscriptions(storage);
  return storage;
}

export function createMemoryCardStorage(): CardStorage {
  const adapter = new MemoryAdapter();
  return new CardStorage(adapter);
}
