import * as vscode from "vscode";
import { CardData } from "./EventTypes";

export type BoardInfo = {
  id: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
};

type StorageEvent =
  | { type: "workspaceBoards"; boardIds: string[] }
  | { type: "boardUpdate"; board: BoardInfo | null; boardId: BoardInfo["id"] }
  | {
      type: "cardUpdate";
      miroLink: CardData["miroLink"];
      card: CardData | null;
    };

export class CardStorage extends vscode.EventEmitter<StorageEvent> {
  private boards = new Map<BoardInfo["id"], BoardInfo>();

  constructor(private context: vscode.ExtensionContext) {
    super();
    const boardIds = this.context.workspaceState.get<string[]>("boardIds");

    boardIds?.forEach((id) => {
      const board = this.context.workspaceState.get<BoardInfo>(`board-${id}`);
      if (board) {
        this.boards.set(board.id, board);
      }
    });
    this.context.subscriptions.push(this);
  }

  async addBoard(boardId: string, name: string) {
    const board: BoardInfo = { id: boardId, name, cards: {} };
    this.boards.set(boardId, board);
    const boardIds = this.context.workspaceState.get<string[]>("boardIds");
    boardIds?.push(boardId);
    await this.context.workspaceState.update("boardIds", boardIds);
    await this.context.workspaceState.update(`board-${boardId}`, board);
    this.fire({ type: "boardUpdate", board, boardId });
    return board;
  }

  async setCard(boardId: string, card: CardData) {
    const board = this.boards.get(boardId);
    if (board) {
      board.cards[card.miroLink!] = card;
      await this.context.workspaceState.update(`board-${boardId}`, board);
      this.fire({ type: "cardUpdate", card, miroLink: card.miroLink });
    }
  }

  getBoard(boardId: string) {
    return this.boards.get(boardId);
  }

  setBoardName(boardId: string, name: string) {
    const board = this.boards.get(boardId);
    if (board) {
      board.name = name;
      this.context.workspaceState.update(`board-${boardId}`, board);
      this.fire({ type: "boardUpdate", board, boardId });
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
      this.context.workspaceState.update(`board-${boardId}`, board);
      this.fire({ type: "boardUpdate", board, boardId });
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
        this.context.workspaceState.update(`board-${b.id}`, b);
        this.fire({ type: "cardUpdate", miroLink: link, card: null });
      }
    });
  }

  clear() {
    this.listBoardIds().forEach((boardId) => {
      this.context.workspaceState.update(`board-${boardId}`, undefined);
      this.fire({ type: "boardUpdate", board: null, boardId: boardId });
    });
    this.boards.clear();
    this.context.workspaceState.update("boardIds", []);
  }

  set(miroLink: string, card: CardData) {
    const url = new URL(miroLink);
    const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
    if (match) {
      const boardId = match[1];
      const board = this.boards.get(boardId);
      if (board) {
        board.cards[miroLink] = card;
        this.context.workspaceState.update(`board-${boardId}`, board);
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
    return [...this.boards.keys()];
  }
  listAllCards() {
    return [...this.boards.values()].flatMap((b) => Object.values(b.cards));
  }
}
