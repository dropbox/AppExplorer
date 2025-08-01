import createDebug from "debug";
import { EventEmitter } from "events";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { MiroServerSocket } from "./server";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { notEmpty } from "./utils/notEmpty";

const debug = createDebug("app-explorer:card-storage");

// Storage adapter interface to abstract persistence layer
export interface StorageAdapter {
  get<T>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

// VSCode adapter that uses ExtensionContext.workspaceState
export class VSCodeAdapter implements StorageAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  get<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.context.workspaceState.update(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.context.workspaceState.update(key, undefined);
  }
}

// Memory adapter that uses Map for in-memory storage
export class MemoryAdapter implements StorageAdapter {
  private storage = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
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
  disconnect: [];
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
  private sockets = new Map<string, MiroServerSocket>();
  private selectedIds: string[] = [];

  protected connectedBoardSet = new Set<string>();
  constructor(private storage: StorageAdapter) {
    super();
    listenToAllEvents(this, (eventName) => {
      debug("Event emitted:", { eventName });
    });
    const boardIds = this.storage.get<string[]>("boardIds");

    boardIds?.forEach((boardId) => {
      const board = this.storage.get<BoardInfo>(`board-${boardId}`);
      if (!board) {
        this.storage.set<BoardInfo>(`board-${boardId}`, {
          boardId,
          cards: {},
          name: boardId,
        });
      }
    });
  }

  dispose(): void {
    this.removeAllListeners();
  }

  getConnectedBoards() {
    return Array.from(this.connectedBoardSet);
  }

  getCardsByBoard(): Record<string, CardData[]> {
    return this.listBoardIds()
      .map(this.getBoard.bind(this))
      .filter(notEmpty)
      .reduce(
        (acc, board) => {
          acc[board.boardId] = Object.values(board.cards);
          return acc;
        },
        {} as Record<string, CardData[]>,
      );
  }

  setCardsByBoard(cardsByBoard: ReturnType<CardStorage["getCardsByBoard"]>) {
    Object.entries(cardsByBoard).forEach(([boardId, cards]) => {
      const board: BoardInfo = { boardId, name: `Board ${boardId}`, cards: {} };
      cards.forEach((card) => {
        board.cards[card.miroLink!] = card;
      });
      this.storage.set(`board-${boardId}`, board);
    });
    this.emitConnectedBoards();
  }

  async disconnectBoard(boardId: string, deleteCards = true) {
    this.connectedBoardSet.delete(boardId);
    this.sockets.delete(boardId);
    this.emitConnectedBoards();
    if (deleteCards) {
      const boardIds = this.storage
        .get<string[]>("boardIds")
        ?.filter((b) => b !== boardId);
      this.storage.delete(`board-${boardId}`);
      this.storage.set("boardIds", boardIds);
    }
  }

  private emitConnectedBoards() {
    this.emit("connectedBoards", {
      type: "connectedBoards",
      boardIds: this.getConnectedBoards(),
    });
  }

  async connectBoard(boardId: string, socket: MiroServerSocket) {
    this.sockets.set(boardId, socket);
    this.connectedBoardSet.add(boardId);
    this.emitConnectedBoards();
    const board = this.getBoard(boardId);
    invariant(board, `Board not found: ${boardId}`);
    debug("Board connected:", { boardId });
    this.emitConnectedBoards();

    socket.on("disconnect", () => {
      this.disconnectBoard(boardId);
    });
  }

  getBoardSocket(boardId: string) {
    return this.sockets.get(boardId);
  }

  async addBoard(boardId: string, name: string) {
    const board: BoardInfo = { boardId: boardId, name, cards: {} };
    this.storage.set(`board-${boardId}`, board);
    const boardIds = this.storage.get<string[]>("boardIds") || [];
    boardIds.push(boardId);
    await this.storage.set("boardIds", boardIds);
    await this.storage.set(`board-${boardId}`, board);
    debug("Board added:", { boardId, name });
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    return board;
  }

  async setCard(boardId: string, card: CardData) {
    const board = this.storage.get<BoardInfo>(`board-${boardId}`);
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
    return this.storage.get<BoardInfo>(`board-${boardId}`);
  }

  setBoardName(boardId: string, name: string) {
    let board: BoardInfo | undefined = this.getBoard(boardId);
    if (board) {
      board.name = name;
    } else {
      board = {
        boardId,
        name,
        cards: {},
      };
    }
    this.storage.set(`board-${boardId}`, board);
    debug("Board name updated:", { boardId, name });
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    return board;
  }

  setBoardCards(boardId: string, cards: CardData[]) {
    let board = this.storage.get<BoardInfo>(`board-${boardId}`);
    debug("setBoardCards", { boardId, cards, board: !!board });
    invariant(board, `Board not found: ${boardId}`);
    if (board) {
      board.cards = cards.reduce(
        (acc, c) => {
          acc[c.miroLink!] = c;
          return acc;
        },
        {} as Record<string, CardData>,
      );
    } else {
      board = {
        boardId,
        name: boardId,
        cards: {},
      };
    }
    this.storage.set(`board-${boardId}`, board);
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
  }

  getCardByLink(link: string): CardData | undefined {
    return this.listBoardIds()
      .map(this.getBoard.bind(this))
      .flatMap((board) => Object.values(board?.cards ?? {}))
      .find((c) => c.miroLink === link);
  }

  deleteCardByLink(link: string) {
    this.listBoardIds()
      .map(this.getBoard.bind(this))
      .map((b) => {
        if (b?.cards[link]) {
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
    debug("Clearing all boards and cards");
    this.listBoardIds().forEach((boardId) => {
      this.storage.delete(`board-${boardId}`);
      this.emit("boardUpdate", {
        type: "boardUpdate",
        board: null,
        boardId: boardId,
      });
    });
    this.storage.set("boardIds", []);
  }

  set(miroLink: string, card: CardData) {
    const url = new URL(miroLink);
    const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
    if (match) {
      const boardId = match[1];
      const board = this.getBoard(boardId);
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
    return this.storage.get<string[]>("boardIds") || [];
  }
  listAllCards(): CardData[] {
    return this.listBoardIds().flatMap((boardId) =>
      Object.values(
        this.storage.get<BoardInfo>(`board-${boardId}`)?.cards || {},
      ),
    );
  }

  selectedCards(data: CardData[]) {
    this.selectedIds = data.map((c) => c.miroLink!);
    this.emit("selectedCards", data);
  }

  getSelectedCardIDs(): string[] {
    return this.selectedIds;
  }
}
