import type { Socket } from "socket.io";
import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { notEmpty } from "./commands/tag-card";
import invariant from "tiny-invariant";
import { logger } from "./ChannelLogger";

export type BoardInfo = {
  id: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
};

type StorageEvent =
  | { type: "workspaceBoards"; boardIds: string[] }
  | { type: "boardUpdate"; board: BoardInfo | null; boardId: BoardInfo["id"] }
  | { type: "connectedBoards"; boards: string[] }
  | {
      type: "cardUpdate";
      miroLink: CardData["miroLink"];
      card: CardData | null;
    };

export class CardStorage extends vscode.EventEmitter<StorageEvent> {
  // private boards = new Map<BoardInfo["id"], BoardInfo>();

  private sockets = new Map<string, Socket>();
  private connectedBoards = new Set<string>();

  constructor(private context: vscode.ExtensionContext) {
    super();
    // const boardIds = this.context.globalState.get<string[]>("boardIds");
    // boardIds?.forEach((id) => {
    //   const board = this.context.globalState.get<BoardInfo>(`board-${id}`);
    //   if (board) {
    //     this.boards.set(board.id, board);
    //   }
    // });
    this.context.subscriptions.push(this);
  }

  getConnectedBoards() {
    return Array.from(this.connectedBoards);
  }

  async connectBoard(boardId: string, socket: Socket) {
    this.sockets.set(boardId, socket);
    this.connectedBoards.add(boardId);
    this.fire({
      type: "connectedBoards",
      boards: this.getConnectedBoards(),
    });

    socket.once("disconnect", () => {
      this.sockets.delete(boardId);
      this.fire({
        type: "connectedBoards",
        boards: this.getConnectedBoards(),
      });
    });
  }

  getBoardSocket(boardId: string) {
    return this.sockets.get(boardId);
  }

  async addBoard(boardId: string, name: string) {
    const board: BoardInfo = { id: boardId, name, cards: {} };
    const boardIds = this.context.globalState.get<string[]>("boardIds");
    boardIds?.push(boardId);
    await this.context.globalState.update("boardIds", boardIds);
    await this.context.globalState.update(`board-${boardId}`, board);
    const b = this.getBoard(boardId);
    invariant(b, `Board ${boardId} not found`);
    this.fire({ type: "boardUpdate", board: b, boardId });
    return board;
  }

  async setCard(boardId: string, card: CardData) {
    const board = this.getBoard(boardId);
    if (board) {
      board.cards[card.miroLink!] = card;
      await this.context.globalState.update(`board-${boardId}`, board);
      this.fire({ type: "cardUpdate", card, miroLink: card.miroLink });
    }
  }

  getBoard(boardId: string): BoardInfo | undefined {
    const board = this.context.globalState.get<BoardInfo>(`board-${boardId}`);
    logger.log("getBoard", boardId, !!board);
    return board;
  }

  async setBoardName(boardId: string, name: string) {
    const board = this.getBoard(boardId);
    if (board) {
      board.name = name;
      await this.context.globalState.update(`board-${boardId}`, board);
      this.fire({ type: "boardUpdate", board, boardId });
    }
    return board;
  }

  async setBoardCards(boardId: string, cards: CardData[]) {
    const board = this.getBoard(boardId);
    if (board) {
      board.cards = cards.reduce(
        (acc, c) => {
          acc[c.miroLink!] = c;
          return acc;
        },
        {} as Record<string, CardData>,
      );
      await this.context.globalState.update(`board-${boardId}`, board);
      logger.log("setBoardCards", boardId, cards.length);
      this.fire({ type: "boardUpdate", board, boardId });
    }
  }

  totalCards() {
    return this.listAllBoards().reduce(
      (acc, b) => acc + Object.keys(b.cards).length,
      0,
    );
  }

  getCardByLink(link: string): CardData | undefined {
    return this.listAllBoards()
      .flatMap((b) => Object.values(b.cards))
      .find((c) => c.miroLink === link);
  }

  deleteCardByLink(link: string) {
    this.listAllBoards().forEach((b) => {
      if (b.cards[link]) {
        delete b.cards[link];
        this.context.globalState.update(`board-${b.id}`, b);
        this.fire({ type: "cardUpdate", miroLink: link, card: null });
      }
    });
  }

  clear() {
    this.listBoardIds().forEach((boardId) => {
      this.context.globalState.update(`board-${boardId}`, undefined);
      this.fire({ type: "boardUpdate", board: null, boardId: boardId });
    });
    this.context.globalState.update("boardIds", []);
  }

  set(miroLink: string, card: CardData) {
    const url = new URL(miroLink);
    const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
    if (match) {
      const boardId = match[1];
      const board = this.getBoard(boardId);
      if (board) {
        board.cards[miroLink] = card;
        this.context.globalState.update(`board-${boardId}`, board);
        this.fire({ type: "cardUpdate", miroLink, card });
      }
    }
  }

  setWorkspaceBoards(boardIds: string[]) {
    if (this.listBoardIds().length === boardIds.length) {
      this.context.workspaceState.update(`board-filter`, undefined);
    } else {
      this.context.workspaceState.update(`board-filter`, boardIds);
    }
    this.fire({ type: "workspaceBoards", boardIds });
  }
  listWorkspaceBoards() {
    return (
      this.context.workspaceState.get<string[]>(`board-filter`) ??
      this.listBoardIds()
    );
  }

  listBoardIds() {
    return this.context.globalState.get<string[]>("boardIds") ?? [];
  }
  listAllBoards() {
    return this.listBoardIds()
      .map((id) => this.getBoard(id))
      .filter(notEmpty);
  }
  listAllCards() {
    return this.listAllBoards().flatMap((b) => Object.values(b.cards));
  }
}
