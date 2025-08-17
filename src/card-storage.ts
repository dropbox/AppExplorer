import { EventEmitter } from "events";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { SymbolPathChangeEvent } from "./document-symbol-tracker";
import { CardData } from "./EventTypes";
import { MiroServerSocket } from "./server/server";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { createDebug } from "./utils/create-debug";
import { notEmpty } from "./utils/notEmpty";
// Storage adapter interface to abstract persistence layer
export interface StorageAdapter {
  get<T>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

// VSCode adapter that uses ExtensionContext.workspaceState
export class VSCodeAdapter implements StorageAdapter {
  #context: vscode.ExtensionContext;
  constructor(context: vscode.ExtensionContext) {
    this.#context = context;
    // this.reset();
  }

  reset() {
    this.#context.workspaceState.keys().forEach((key) => {
      if (key.startsWith("board-")) {
        this.delete(key);
      }
    });

    this.delete("boardIds");
  }

  get<T>(key: string): T | undefined {
    return this.#context.workspaceState.get<T>(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.#context.workspaceState.update(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.#context.workspaceState.update(key, undefined);
  }
}

// Memory adapter that uses Map for in-memory storage
export class MemoryAdapter implements StorageAdapter {
  #storage = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.#storage.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.#storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#storage.delete(key);
  }
}

export type BoardInfo = {
  boardId: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
};

type StorageEvent = {
  disconnect: [{ type: "disconnect" }];
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
  selectedCards: [{ type: "selectedCards"; cards: CardData[] }];
  symbolsChanged: [SymbolPathChangeEvent];
};

export class CardStorage
  extends EventEmitter<StorageEvent>
  implements vscode.Disposable
{
  protected debug = createDebug("app-explorer:card-storage");
  #storage: StorageAdapter;
  #sockets = new Map<string, MiroServerSocket>();
  #selectedIds: string[] = [];
  protected connectedBoardSet = new Set<string>();
  constructor(storage: StorageAdapter) {
    super();
    this.#storage = storage;
    listenToAllEvents(this, (eventName, ...args) => {
      this.debug("Event emitted:", JSON.stringify(eventName), { args }, ";");
    });
    const boardIds = this.#storage.get<string[]>("boardIds");
    this.#storage.set("boardIds", [...new Set(boardIds)]);

    boardIds?.forEach((boardId) => {
      const board = this.#storage.get<BoardInfo>(`board-${boardId}`);
      if (!board) {
        this.#storage.set<BoardInfo>(`board-${boardId}`, {
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
    const boardIds = Object.keys(cardsByBoard);
    this.connectedBoardSet = new Set(boardIds);
    this.#storage.set("boardIds", boardIds);
    Object.entries(cardsByBoard).forEach(([boardId, cards]) => {
      const board: BoardInfo = { boardId, name: `Board ${boardId}`, cards: {} };
      cards.forEach((card) => {
        board.cards[card.miroLink!] = card;
      });
      this.#storage.set(`board-${boardId}`, board);
    });
    this.emitConnectedBoards();
  }

  async disconnectBoard(boardId: string, deleteCards = true) {
    this.debug("Disconnecting board:", { boardId });
    this.connectedBoardSet.delete(boardId);
    this.#sockets.delete(boardId);
    if (deleteCards) {
      const boardIds = this.#storage
        .get<string[]>("boardIds")
        ?.filter((b) => b !== boardId);
      this.#storage.delete(`board-${boardId}`);
      this.#storage.set("boardIds", boardIds);
    }
    this.emitConnectedBoards();
  }

  private emitConnectedBoards() {
    this.emit("connectedBoards", {
      type: "connectedBoards",
      boardIds: this.getConnectedBoards(),
    });
  }

  async connectBoard(boardId: string, socket: MiroServerSocket) {
    this.debug("Connecting board:", { boardId });
    this.#sockets.set(boardId, socket);
    this.connectedBoardSet.add(boardId);
    const board = this.getBoard(boardId);
    invariant(board, `Board not found: ${boardId}`);
    this.debug("Board connected:", { boardId });
    this.emitConnectedBoards();

    socket.on("disconnect", () => {
      this.disconnectBoard(boardId);
    });
  }

  getBoardSocket(boardId: string) {
    return this.#sockets.get(boardId);
  }

  async addBoard(boardId: string, name: string) {
    const board: BoardInfo = { boardId: boardId, name, cards: {} };
    this.#storage.set(`board-${boardId}`, board);
    const boardIds = this.#storage.get<string[]>("boardIds") || [];
    if (!boardIds.includes(boardId)) {
      boardIds.push(boardId);
    }
    await this.#storage.set("boardIds", boardIds);
    await this.#storage.set(`board-${boardId}`, board);
    this.debug("Board added:", { boardId, name });
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    return board;
  }

  async setCard(boardId: string, card: CardData) {
    const board = this.#storage.get<BoardInfo>(`board-${boardId}`);
    if (board) {
      board.cards[card.miroLink!] = card;
      await this.#storage.set(`board-${boardId}`, board);
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
    return this.#storage.get<BoardInfo>(`board-${boardId}`);
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
    this.#storage.set(`board-${boardId}`, board);
    const boardIds = this.#storage.get<string[]>("boardIds") || [];
    if (!boardIds.includes(boardId)) {
      boardIds.push(boardId);
    }
    this.#storage.set("boardIds", boardIds);
    this.debug("Board name updated:", { boardId, name });
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
    return board;
  }

  setBoardCards(boardId: string, cards: CardData[]) {
    let board = this.#storage.get<BoardInfo>(`board-${boardId}`);
    this.debug("setBoardCards", { boardId, cards, board: !!board });
    invariant(board, `Board not found: ${boardId}`);
    if (board) {
      board.cards = cards.reduce(
        (acc: Record<string, CardData>, c: CardData) => {
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
    this.#storage.set(`board-${boardId}`, board);
    const boardIds = this.#storage.get<string[]>("boardIds") || [];
    if (!boardIds.includes(boardId)) {
      boardIds.push(boardId);
    }
    this.#storage.set("boardIds", boardIds);
    this.emit("boardUpdate", { type: "boardUpdate", board, boardId });
  }

  getCardByLink(link: string): CardData | undefined {
    return this.listBoardIds()
      .map(this.getBoard.bind(this))
      .flatMap((board: BoardInfo | undefined) =>
        Object.values(board?.cards ?? {}),
      )
      .find((c: CardData) => c.miroLink === link);
  }

  deleteCardByLink(link: string) {
    this.listBoardIds()
      .map(this.getBoard.bind(this))
      .map((b: BoardInfo | undefined) => {
        if (b?.cards[link]) {
          delete b.cards[link];
          this.#storage.set(`board-${b.boardId}`, b);
          this.emit("cardUpdate", {
            type: "cardUpdate",
            miroLink: link,
            card: null,
          });
        }
      });
  }

  clear() {
    this.debug("Clearing all boards and cards");
    this.listBoardIds().forEach((boardId: string) => {
      this.#storage.delete(`board-${boardId}`);
      this.emit("boardUpdate", {
        type: "boardUpdate",
        board: null,
        boardId: boardId,
      });
    });
    this.#storage.set("boardIds", []);
  }

  set(miroLink: string, card: CardData) {
    const url = new URL(miroLink);
    const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
    if (match) {
      const boardId = match[1];
      const board = this.getBoard(boardId);
      if (board) {
        board.cards[miroLink] = card;
        this.#storage.set(`board-${boardId}`, board);
        this.emit("cardUpdate", { type: "cardUpdate", miroLink, card });
      }
    }
  }

  setWorkspaceBoards(boardIds: string[]) {
    if (this.listBoardIds().length === boardIds.length) {
      this.#storage.delete(`board-filter`);
    } else {
      this.#storage.set(`board-filter`, boardIds);
    }
    this.emit("workspaceBoards", { type: "workspaceBoards", boardIds });
  }
  listBoardIds() {
    const ids = this.#storage.get<string[]>("boardIds") || [];
    return ids;
  }
  listAllCards(): CardData[] {
    return this.listBoardIds().flatMap((boardId: string) =>
      Object.values(
        this.#storage.get<BoardInfo>(`board-${boardId}`)?.cards || {},
      ),
    );
  }

  selectedCards(data: CardData[]) {
    this.#selectedIds = data.map((c: CardData) => c.miroLink!);
    this.debug("emit selectedCards", { cards: data });
    this.emit("selectedCards", { type: "selectedCards", cards: data });
  }

  getSelectedCardIDs(): string[] {
    return this.#selectedIds;
  }
}
