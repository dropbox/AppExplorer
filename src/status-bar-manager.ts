import * as vscode from "vscode";
import { CardStorage } from "./card-storage";
import { HandlerContext } from "./extension";

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;

  constructor(
    private connectedBoards: HandlerContext["connectedBoards"],
    private cardStorage: CardStorage,
    context: vscode.ExtensionContext,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";
    context.subscriptions.push(this.statusBar);
    cardStorage.subscribe(() => this.renderStatusBar());
  }

  renderStatusBar() {
    const { connectedBoards, statusBar, cardStorage } = this;
    if (connectedBoards.size == 0) {
      statusBar.backgroundColor = "red";
    }
    const boardIds = cardStorage.listWorkspaceBoards();
    const allCards = boardIds.flatMap((boardId) =>
      Object.values(cardStorage.getBoard(boardId)!.cards),
    );
    const totalCards = allCards.length;
    if (connectedBoards.size > 0) {
      const disconnected = allCards.filter(
        (card) => card.status === "disconnected",
      ).length;

      statusBar.text = `$(app-explorer) (${totalCards} $(preview) ${boardIds.length} $(window)${
        disconnected > 0 ? `, ${disconnected} $(debug-disconnect)` : ""
      })`;
    } else {
      statusBar.text = `$(app-explorer)  (${connectedBoards.size} Miro connections)`;
    }
    statusBar.show();
  }
}
