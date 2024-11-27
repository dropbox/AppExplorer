import * as vscode from "vscode";
import { CardData } from "./EventTypes";

export type BoardInfo = {
  id: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
};

export class CardStorage {
  private boards = new Map<BoardInfo["id"], BoardInfo>();

  constructor(private context: vscode.ExtensionContext) {
    const boardIds = this.context.workspaceState.get<string[]>("boardIds");

    boardIds?.forEach((id) => {
      const board = this.context.workspaceState.get<BoardInfo>(`board-${id}`);
      if (board) {
        this.boards.set(board.id, board);
      }
    });
  }

  async addBoard(boardId: string, name: string) {
    const board: BoardInfo = { id: boardId, name, cards: {} };
    this.boards.set(boardId, board);
    const boardIds = this.context.workspaceState.get<string[]>("boardIds");
    boardIds?.push(boardId);
    await this.context.workspaceState.update("boardIds", boardIds);
    await this.context.workspaceState.update(`board-${boardId}`, board);
  }

  async addCard(boardId: string, card: CardData) {
    const board = this.boards.get(boardId);
    if (board) {
      board.cards[card.miroLink!] = card;
      await this.context.workspaceState.update(`board-${boardId}`, board);
    }
  }

  async getBoard(boardId: string) {
    return this.boards.get(boardId);
  }

  totalCards() {
    return [...this.boards.values()].reduce(
      (acc, b) => acc + Object.keys(b.cards).length,
      0,
    );
  }

  listBoards() {
    return [...this.boards.keys()];
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
      }
    });
  }

  clear() {
    this.listBoards().forEach((id) => {
      this.context.workspaceState.update(`board-${id}`, undefined);
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
      }
    }
  }

  values() {
    return [...this.boards.values()].flatMap((b) => Object.values(b.cards));
  }
}
