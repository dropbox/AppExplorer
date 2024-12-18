import * as vscode from "vscode";
import { Socket } from "socket.io";
import { CardStorage } from "./card-storage";

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;

  constructor(
    private sockets: Map<string, Socket>,
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
    const { sockets, statusBar, cardStorage } = this;
    if (sockets.size == 0) {
      statusBar.backgroundColor = "red";
    }
    const boardIds = cardStorage.listWorkspaceBoards();
    const allCards = boardIds.flatMap((boardId) =>
      Object.values(cardStorage.getBoard(boardId)!.cards),
    );
    const totalCards = allCards.length;
    if (sockets.size > 0) {
      const disconnected = allCards.filter(
        (card) => card.status === "disconnected",
      ).length;

      statusBar.text = `$(app-explorer) (${totalCards} $(preview) ${boardIds.length} $(window)${
        disconnected > 0 ? `, ${disconnected} $(debug-disconnect)` : ""
      })`;
    } else {
      statusBar.text = `$(app-explorer)  (${sockets.size} Miro connections)`;
    }
    statusBar.show();
  }
}
