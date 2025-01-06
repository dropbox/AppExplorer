import * as vscode from "vscode";
import { CardStorage } from "./card-storage";

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;

  constructor(private cardStorage: CardStorage) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";
    cardStorage.event(() => this.renderStatusBar());
  }

  dispose() {
    this.statusBar.dispose();
  }

  renderStatusBar() {
    const connectedBoards = this.cardStorage.getConnectedBoards();
    if (connectedBoards.length == 0) {
      this.statusBar.backgroundColor = "red";
    }
    const boardIds = this.cardStorage.listWorkspaceBoards();
    const allCards = boardIds.flatMap((boardId) =>
      Object.values(this.cardStorage.getBoard(boardId)!.cards),
    );
    const totalCards = allCards.length;
    if (connectedBoards.length > 0) {
      const disconnected = allCards.filter(
        (card) => card.status === "disconnected",
      ).length;

      this.statusBar.text = `$(app-explorer) (${totalCards} $(preview) ${boardIds.length} $(window)${
        disconnected > 0 ? `, ${disconnected} $(debug-disconnect)` : ""
      })`;
    } else {
      this.statusBar.text = `$(app-explorer)  (${connectedBoards.length} Miro connections)`;
    }
    this.statusBar.show();
  }
}
